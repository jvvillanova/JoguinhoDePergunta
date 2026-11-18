/**
 * Testes unitários e de integridade do motor de jogo, do controle de qualidade e do banco.
 * Execução: node --env-file=.env --import tsx --test tests/engine.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as engine from "../src/lib/game/engine";
import type { GameConfigSnapshot, Option, QuestionSecret } from "../src/lib/game/engine";
import { parseQuestionBlock, parseQuestionLine, validateQuestion, questionKey } from "../src/lib/bank/quality";
import { BANK_BLOCKS } from "../src/data/bank";
import { DEFAULT_PRIZES } from "../src/lib/config";

const config = (over: Partial<GameConfigSnapshot> = {}): GameConfigSnapshot => ({
  prizes: DEFAULT_PRIZES,
  safetyQuestions: [5, 10],
  helpLimits: { cards: 1, fifty: 1, audience: 1, presenter: 1 },
  timerSeconds: 0,
  maxQuestions: null,
  lives: null,
  specialPhrase: "Valendo um milhão de taliaruras duras!",
  ...over,
});

const question = (id: number, correct: Option = "B", over: Partial<QuestionSecret> = {}): QuestionSecret => ({
  id,
  statement: `Pergunta de teste número ${id}?`,
  options: { A: "Opção um", B: "Opção dois", C: "Opção três", D: "Opção quatro" },
  category: "Teste",
  difficulty: "facil",
  correct,
  justification: "Justificativa de teste suficientemente longa para validar.",
  source: "Fonte de teste",
  hint: "Dica de teste",
  ...over,
});

const start = (cfg = config(), mode: engine.Mode = "classic", qid = 1, correct: Option = "B") =>
  engine.createState({ mode, config: cfg, question: question(qid, correct), now: 1_000 });

/** Responde a pergunta atual com a alternativa dada e avança até a próxima fase de escolha. */
function answer(state: engine.GameState, option: Option, nextId: number, correct: Option = "B") {
  let s = engine.selectOption(state, option);
  s = engine.confirmChoice(s, 2_000);
  s = engine.reveal(s);
  if (s.phase === "revealed") s = engine.advance(s, question(nextId, correct), 3_000);
  return s;
}

describe("premiação e pontos de segurança", () => {
  it("premiação acumulada é o valor da última pergunta correta", () => {
    assert.equal(engine.prizeForCorrectCount(DEFAULT_PRIZES, 0), 0);
    assert.equal(engine.prizeForCorrectCount(DEFAULT_PRIZES, 1), 1000);
    assert.equal(engine.prizeForCorrectCount(DEFAULT_PRIZES, 17), 1000000);
  });

  it("o valor garantido é o do último ponto de segurança atingido", () => {
    assert.equal(engine.safePrize(DEFAULT_PRIZES, [5, 10], 4), 0);
    assert.equal(engine.safePrize(DEFAULT_PRIZES, [5, 10], 5), 5000);
    assert.equal(engine.safePrize(DEFAULT_PRIZES, [5, 10], 9), 5000);
    assert.equal(engine.safePrize(DEFAULT_PRIZES, [5, 10], 12), 50000);
  });
});

describe("fluxo da pergunta (máquina de estados)", () => {
  it("permite trocar a alternativa antes de confirmar e bloqueia após confirmação", () => {
    let s = start();
    s = engine.selectOption(s, "A");
    s = engine.selectOption(s, "C");
    assert.equal(s.choice, "C");
    s = engine.confirmChoice(s, 2_000);
    assert.equal(s.phase, "locked");
    assert.throws(() => engine.selectOption(s, "B"), engine.GameRuleError);
  });

  it("não confirma sem escolha e não revela antes da confirmação", () => {
    const s = start();
    assert.throws(() => engine.confirmChoice(s, 2_000), /Escolha uma alternativa/);
    assert.throws(() => engine.reveal(s), /após a confirmação/);
  });

  it("revelação é idempotente: não reprocessa a mesma resposta", () => {
    let s = engine.confirmChoice(engine.selectOption(start(), "B"), 2_000);
    s = engine.reveal(s);
    const again = engine.reveal(s);
    assert.equal(again, s);
    assert.equal(again.correctCount, 1);
  });

  it("acerto avança a premiação e permite a próxima pergunta somente após revelação", () => {
    let s = start();
    s = engine.selectOption(s, "B");
    s = engine.confirmChoice(s, 2_000);
    assert.throws(() => engine.advance(s, question(2), 3_000), /após a revelação/);
    s = engine.reveal(s);
    assert.equal(s.outcome, "correct");
    assert.equal(s.prize, 1000);
    s = engine.advance(s, question(2), 3_000);
    assert.equal(s.phase, "awaiting_choice");
    assert.equal(s.levelIndex, 1);
    assert.deepEqual(s.usedQuestionIds, [1, 2]);
  });

  it("erro encerra a partida com o último ponto de segurança", () => {
    let s = start();
    for (let i = 1; i <= 6; i++) s = answer(s, "B", i + 1);
    assert.equal(s.correctCount, 6);
    s = engine.selectOption(s, "A");
    s = engine.confirmChoice(s, 2_000);
    s = engine.reveal(s);
    assert.equal(s.phase, "finished");
    assert.equal(s.outcome, "defeat");
    assert.equal(s.finalPrize, 5000);
  });

  it("erro antes do primeiro ponto de segurança resulta em zero", () => {
    let s = engine.confirmChoice(engine.selectOption(start(), "A"), 2_000);
    s = engine.reveal(s);
    assert.equal(s.finalPrize, 0);
    assert.equal(s.phase, "finished");
  });
});

describe("desistência", () => {
  it("recebe a premiação acumulada antes de confirmar", () => {
    let s = start();
    for (let i = 1; i <= 3; i++) s = answer(s, "B", i + 1);
    s = engine.walkaway(s);
    assert.equal(s.phase, "finished");
    assert.equal(s.finalPrize, 3000);
    assert.equal(s.outcome, "walkaway");
  });

  it("não é permitida após confirmar a resposta", () => {
    const s = engine.confirmChoice(engine.selectOption(start(), "B"), 2_000);
    assert.throws(() => engine.walkaway(s), /antes de confirmar/);
  });
});

describe("ajudas", () => {
  it("50/50 elimina duas erradas e mantém a correta", () => {
    const s = start(config(), "classic", 1, "C");
    const r = engine.useHelp(s, "fifty", Math.random);
    const eliminated = r.state.questionHelps.eliminated;
    assert.equal(eliminated.length, 2);
    assert.ok(!eliminated.includes("C"));
  });

  it("plateia é sempre simulada e soma 100%", () => {
    const r = engine.useHelp(start(), "audience", () => 0.5);
    const votes = (r.result as { votes: Record<Option, number>; simulated: boolean });
    assert.equal(votes.simulated, true);
    assert.equal(Object.values(votes.votes).reduce((a, b) => a + b, 0), 100);
  });

  it("cartas exigem índice válido e aplicam intensidade", () => {
    assert.throws(() => engine.useHelp(start(), "cards", Math.random, { index: 9 }), /quatro cartas/);
    const r = engine.useHelp(start(), "cards", Math.random, { index: 2 });
    assert.ok(["forte", "media", "fraca"].includes((r.result as { intensity: string }).intensity));
  });

  it("limite por partida e uma vez por pergunta são respeitados", () => {
    const r = engine.useHelp(start(), "presenter", Math.random);
    assert.throws(() => engine.useHelp(r.state, "presenter", Math.random), /já utilizou|já foi usada/);
    let s = engine.advance(
      engine.reveal(engine.confirmChoice(engine.selectOption(r.state, "B"), 2_000)),
      question(2),
      3_000,
    );
    assert.throws(() => engine.useHelp(s, "presenter", Math.random), /todas as ajudas/);
    s = engine.selectOption(s, "A");
    assert.equal(s.choice, "A");
  });

  it("apresentador devolve dica da pergunta, sem revelar a alternativa", () => {
    const r = engine.useHelp(start(), "presenter", Math.random);
    assert.equal(r.result && (r.result as { hint: string }).hint, "Dica de teste");
    const view = JSON.stringify(engine.publicView(r.state));
    assert.ok(!view.includes('"correct":"B"'));
  });

  it("ajuda não é aceita após confirmação", () => {
    const s = engine.confirmChoice(engine.selectOption(start(), "B"), 2_000);
    assert.throws(() => engine.useHelp(s, "fifty", Math.random), /antes de confirmar/);
  });
});

describe("finalização e modos", () => {
  it("vitória ao responder todas as perguntas do modo clássico", () => {
    let s = start();
    for (let i = 1; i <= 16; i++) s = answer(s, "B", i + 1);
    s = engine.selectOption(s, "B");
    s = engine.reveal(engine.confirmChoice(s, 2_000));
    assert.equal(s.phase, "finished");
    assert.equal(s.outcome, "victory");
    assert.equal(s.finalPrize, 1000000);
  });

  it("modo treinamento não encerra no erro e não gera premiação", () => {
    let s = engine.reveal(engine.confirmChoice(engine.selectOption(start(config(), "training"), "A"), 2_000));
    assert.equal(s.phase, "revealed");
    s = engine.advance(s, question(2), 3_000);
    assert.equal(s.phase, "awaiting_choice");
  });

  it("sobrevivência perde vidas e só encerra quando zerar", () => {
    let s = start(config({ lives: 2 }), "survival");
    s = engine.reveal(engine.confirmChoice(engine.selectOption(s, "A"), 2_000));
    assert.equal(s.lives, 1);
    assert.equal(s.phase, "revealed");
    s = engine.advance(s, question(2), 3_000);
    s = engine.reveal(engine.confirmChoice(engine.selectOption(s, "A"), 4_000));
    assert.equal(s.phase, "finished");
    assert.equal(s.lives, 0);
  });

  it("modo rápido vence ao completar o número de perguntas configurado", () => {
    let s = start(config({ maxQuestions: 2 }), "quick");
    s = answer(s, "B", 2);
    s = engine.reveal(engine.confirmChoice(engine.selectOption(s, "B"), 2_000));
    assert.equal(s.outcome, "victory");
    assert.equal(s.phase, "finished");
  });

  it("tempo esgotado conta como erro sem alternativa", () => {
    const cfg = config({ prizes: DEFAULT_PRIZES });
    const s0 = { ...start(cfg), config: { ...cfg, prizes: DEFAULT_PRIZES } };
    const timed = { ...s0, config: { ...s0.config }, questionStartedAt: 0 } as engine.GameState;
    (timed.config as GameConfigSnapshot).timerSeconds = 5;
    assert.equal(engine.timerExpired(timed, 60_000), true);
    const r = engine.resolveTimeout(timed);
    assert.equal(r.outcome, "defeat");
    assert.equal(r.reveal?.isCorrect, false);
  });

  it("a visão pública não expõe a alternativa correta antes da revelação", () => {
    const view = engine.publicView(engine.selectOption(start(), "A"));
    assert.equal("correct" in (view.question ?? {}), false);
    assert.equal(view.reveal, null);
  });

  it("escolha de próxima pergunta evita repetições quando há alternativas", () => {
    const cands = [
      { id: 1, difficulty: "facil" as const },
      { id: 2, difficulty: "facil" as const },
    ];
    const id = engine.pickNextQuestionId(cands, "facil", new Set([1]), () => 0);
    assert.equal(id, 2);
  });

  it("desafio diário é determinístico para o mesmo dia", () => {
    const a = engine.seededRandom("2026-01-01:1");
    const b = engine.seededRandom("2026-01-01:1");
    assert.equal(a(), b());
  });
});

describe("controle de qualidade", () => {
  const base = {
    category: "Geografia",
    difficulty: "facil",
    statement: "Qual é a capital do Brasil?",
    options: { A: "Rio", B: "Brasília", C: "Recife", D: "Salvador" },
    correct: "B",
    justification: "Brasília é a capital federal desde 1960 conforme o IBGE.",
    source: "IBGE",
    tags: ["brasil"],
  };

  it("aceita uma pergunta bem formada", () => {
    assert.deepEqual(validateQuestion(base).errors, []);
  });

  it("rejeita alternativas repetidas, resposta inválida e falta de justificativa", () => {
    const repeated = validateQuestion({ ...base, options: { ...base.options, C: "rio" } });
    assert.ok(repeated.errors.some((e) => e.includes("repetidas")));
    const badCorrect = validateQuestion({ ...base, correct: "E" });
    assert.ok(badCorrect.errors.some((e) => e.includes("A, B, C ou D")));
    const noJustification = validateQuestion({ ...base, justification: "curta" });
    assert.ok(noJustification.errors.some((e) => e.includes("Justificativa")));
  });

  it("rejeita alternativa ambígua e enunciado incompleto", () => {
    const ambiguous = validateQuestion({ ...base, options: { ...base.options, D: "Todas as anteriores" } });
    assert.ok(ambiguous.errors.some((e) => e.includes("ambígua")));
    const short = validateQuestion({ ...base, statement: "Capital?" });
    assert.ok(short.errors.length > 0);
  });

  it("normaliza acentos e pontuação para detectar duplicidade", () => {
    assert.equal(questionKey("Qual é a capital do Brasil?"), questionKey("qual e a capital do brasil"));
  });

  it("linha de importação exige exatamente 11 campos", () => {
    assert.throws(() => parseQuestionLine("Geografia|facil|Enunciado|A|B|C|D"), /11 campos/);
    const q = parseQuestionLine("Geografia|facil|Qual é a capital do Brasil?|Rio|Brasília|Recife|Salvador|B|Justificativa suficiente aqui.|IBGE|brasil,capitais");
    assert.equal(q.correct, "B");
    assert.deepEqual(q.tags, ["brasil", "capitais"]);
  });

  it("todas as perguntas do banco oficial são válidas e não duplicadas", () => {
    let total = 0;
    const seen = new Set<string>();
    const problems: string[] = [];
    for (const block of BANK_BLOCKS) {
      const { items, errors } = parseQuestionBlock(block);
      assert.deepEqual(errors, [], "linhas de importação com erro de formato");
      for (const it of items) {
        total++;
        const { errors: errs } = validateQuestion(it);
        if (errs.length) problems.push(`${it.statement}: ${errs.join("; ")}`);
        const key = questionKey(it.statement);
        if (seen.has(key)) problems.push(`duplicada: ${it.statement}`);
        seen.add(key);
      }
    }
    assert.deepEqual(problems, []);
    assert.ok(total >= 100, `banco com ${total} perguntas`);
    console.log(`Banco oficial verificado: ${total} perguntas válidas e sem duplicidade exata.`);
  });
});
