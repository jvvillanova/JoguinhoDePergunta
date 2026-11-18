/**
 * Motor de jogo puro (sem I/O). Toda regra essencial vive aqui e é coberta por testes.
 * Estados: awaiting_choice -> locked -> revealed -> (awaiting_choice | finished).
 */
import type { Difficulty, HelpLimits } from "@/lib/config";

export const OPTIONS = ["A", "B", "C", "D"] as const;
export type Option = (typeof OPTIONS)[number];
export type Mode = "classic" | "infinite" | "quick" | "survival" | "categories" | "training" | "daily";
export type Phase = "awaiting_choice" | "locked" | "revealed" | "finished";
export type HelpType = "cards" | "fifty" | "audience" | "presenter";
export type Outcome = "correct" | "wrong" | "timeout" | "walkaway" | "victory" | "defeat";

export type Options = Record<Option, string>;

export type QuestionSecret = {
  id: number;
  statement: string;
  options: Options;
  category: string;
  difficulty: Difficulty;
  correct: Option;
  justification: string;
  source: string;
  hint: string;
};

export type GameConfigSnapshot = {
  prizes: number[];
  safetyQuestions: number[];
  helpLimits: HelpLimits;
  timerSeconds: number;
  maxQuestions: number | null; // quick/daily
  lives: number | null; // survival
  specialPhrase: string;
};

export type GameState = {
  mode: Mode;
  phase: Phase;
  config: GameConfigSnapshot;
  levelIndex: number; // 0-based
  correctCount: number;
  lives: number | null;
  question: QuestionSecret | null;
  choice: Option | null;
  questionStartedAt: number;
  lockedAt: number | null;
  usedQuestionIds: number[];
  helpsUsed: HelpLimits;
  questionHelps: {
    eliminated: Option[];
    audience: Record<Option, number> | null;
    card: { index: number; option: Option; intensity: "forte" | "media" | "fraca" } | null;
    hint: string | null;
    used: HelpType[];
  };
  reveal: { chosen: Option | null; correct: Option; isCorrect: boolean; justification: string; source: string } | null;
  outcome: Outcome | null;
  endReason: string | null;
  prize: number;
  finalPrize: number | null;
  categories: string[] | null;
  dailyDay: string | null;
  history: { questionId: number; chosen: Option | null; correct: boolean; level: number }[];
};

/** Violação de regra de jogo (estado inválido para a ação). Mapeada para HTTP 409 pela camada de API. */
export class GameRuleError extends Error {
  readonly status = 409;
}

function fail(message: string): never {
  throw new GameRuleError(message);
}

/** Premiação acumulada: valor da última pergunta respondida corretamente. */
export function prizeForCorrectCount(prizes: number[], correctCount: number): number {
  if (correctCount <= 0) return 0;
  return prizes[Math.min(correctCount, prizes.length) - 1] ?? 0;
}

/** Valor garantido pelo último ponto de segurança atingido (0 se nenhum). */
export function safePrize(prizes: number[], safetyQuestions: number[], correctCount: number): number {
  let best = 0;
  for (const s of safetyQuestions) {
    if (s <= correctCount && s >= 1 && s <= prizes.length) best = Math.max(best, prizes[s - 1]);
  }
  return best;
}

export function createState(params: {
  mode: Mode;
  config: GameConfigSnapshot;
  question: QuestionSecret;
  categories?: string[] | null;
  dailyDay?: string | null;
  now: number;
}): GameState {
  return {
    mode: params.mode,
    phase: "awaiting_choice",
    config: params.config,
    levelIndex: 0,
    correctCount: 0,
    lives: params.mode === "survival" ? params.config.lives : null,
    question: params.question,
    choice: null,
    questionStartedAt: params.now,
    lockedAt: null,
    usedQuestionIds: [params.question.id],
    helpsUsed: { cards: 0, fifty: 0, audience: 0, presenter: 0 },
    questionHelps: { eliminated: [], audience: null, card: null, hint: null, used: [] },
    reveal: null,
    outcome: null,
    endReason: null,
    prize: 0,
    finalPrize: null,
    categories: params.categories ?? null,
    dailyDay: params.dailyDay ?? null,
    history: [],
  };
}

/** Visão segura para o cliente: nunca inclui a alternativa correta antes da revelação. */
export function publicView(state: GameState) {
  const q = state.question;
  const revealed = state.phase === "revealed" || state.phase === "finished";
  return {
    mode: state.mode,
    phase: state.phase,
    levelIndex: state.levelIndex,
    levelNumber: state.levelIndex + 1,
    totalLevels: state.config.maxQuestions ?? state.config.prizes.length,
    prizes: state.config.prizes,
    safetyQuestions: state.config.safetyQuestions,
    safePrize: safePrize(state.config.prizes, state.config.safetyQuestions, state.correctCount),
    correctCount: state.correctCount,
    lives: state.lives,
    prize: state.prize,
    finalPrize: state.finalPrize,
    currentPrize: prizeForCorrectCount(state.config.prizes, state.correctCount),
    question: q
      ? {
          id: q.id,
          statement: q.statement,
          options: q.options,
          category: q.category,
          difficulty: q.difficulty,
        }
      : null,
    choice: state.choice,
    locked: state.phase === "locked" || revealed,
    eliminated: state.questionHelps.eliminated,
    audience: state.questionHelps.audience,
    card: state.questionHelps.card,
    hint: state.questionHelps.hint,
    helpsUsed: state.helpsUsed,
    helpLimits: state.config.helpLimits,
    helpsUsedThisQuestion: state.questionHelps.used,
    timerSeconds: state.config.timerSeconds,
    questionStartedAt: state.questionStartedAt,
    reveal: revealed ? state.reveal : null,
    outcome: state.outcome,
    endReason: state.endReason,
    specialPhrase: state.config.specialPhrase,
  };
}

export function selectOption(state: GameState, option: Option): GameState {
  if (state.phase !== "awaiting_choice") fail("A resposta já foi confirmada e não pode ser alterada.");
  if (!OPTIONS.includes(option)) fail("Alternativa inválida.");
  if (state.questionHelps.eliminated.includes(option)) fail("Esta alternativa foi eliminada pela ajuda.");
  return { ...state, choice: option };
}

/** Confirma a escolha. Após isso a resposta fica bloqueada. */
export function confirmChoice(state: GameState, now: number): GameState {
  if (state.phase !== "awaiting_choice") fail("Não é possível confirmar neste momento.");
  if (!state.choice) fail("Escolha uma alternativa antes de confirmar.");
  if (timerExpired(state, now)) return resolveTimeout(state);
  return { ...state, phase: "locked", lockedAt: now };
}

export function timerExpired(state: GameState, now: number): boolean {
  const t = state.config.timerSeconds;
  if (!t || state.phase !== "awaiting_choice") return false;
  return now - state.questionStartedAt > (t + 2) * 1000; // 2s de tolerância de rede
}

/** Tempo esgotado: a pergunta é tratada como erro sem alternativa escolhida. */
export function resolveTimeout(state: GameState): GameState {
  if (state.phase !== "awaiting_choice" && state.phase !== "locked") fail("Tempo indisponível neste estado.");
  return applyResult({ ...state, choice: null }, "timeout");
}

/** Revela a resposta e aplica as regras de pontuação. Idempotente após revelação. */
export function reveal(state: GameState): GameState {
  if (state.phase === "revealed" || state.phase === "finished") return state;
  if (state.phase !== "locked") fail("A revelação só ocorre após a confirmação.");
  const isCorrect = state.choice === state.question?.correct;
  return applyResult(state, isCorrect ? "correct" : "wrong");
}

function applyResult(state: GameState, kind: "correct" | "wrong" | "timeout"): GameState {
  const q = state.question;
  if (!q) fail("Nenhuma pergunta ativa.");
  const isCorrect = kind === "correct";
  const level = state.levelIndex + 1;
  const correctCount = state.correctCount + (isCorrect ? 1 : 0);
  const history = [
    ...state.history,
    { questionId: q.id, chosen: state.choice, correct: isCorrect, level },
  ].slice(-50);
  const reveal = {
    chosen: state.choice,
    correct: q.correct,
    isCorrect,
    justification: q.justification,
    source: q.source,
  };
  const base: GameState = { ...state, phase: "revealed", correctCount, reveal, history };

  if (isCorrect) {
    const prize = prizeForCorrectCount(state.config.prizes, correctCount);
    const next = { ...base, prize, outcome: "correct" as Outcome };
    const max = state.config.maxQuestions ?? (state.mode === "infinite" ? Infinity : state.config.prizes.length);
    if (state.mode !== "infinite" && correctCount >= max) {
      return finish(next, "victory", state.mode === "training" ? 0 : prize, "Você respondeu todas as perguntas corretamente.");
    }
    return next;
  }

  // Erro ou tempo esgotado
  const outcome: Outcome = kind === "timeout" ? "timeout" : "wrong";
  if (state.mode === "training") {
    return { ...base, outcome, prize: state.prize };
  }
  if (state.mode === "survival") {
    const lives = (state.lives ?? 1) - 1;
    if (lives > 0) return { ...base, lives, outcome };
    return finish({ ...base, lives, outcome }, "defeat", safePrize(state.config.prizes, state.config.safetyQuestions, correctCount), "Suas vidas acabaram.");
  }
  const reason = kind === "timeout" ? "O tempo para responder esgotou." : "Resposta incorreta.";
  return finish({ ...base, outcome }, "defeat", safePrize(state.config.prizes, state.config.safetyQuestions, correctCount), reason);
}

function finish(state: GameState, outcome: Outcome, finalPrize: number, endReason: string): GameState {
  return { ...state, phase: "finished", outcome, finalPrize, prize: finalPrize, endReason };
}

/** Avança para a próxima pergunta após a revelação (nunca antes). */
export function advance(state: GameState, next: QuestionSecret, now: number): GameState {
  if (state.phase !== "revealed") fail("O avanço só ocorre após a revelação da resposta.");
  if (state.outcome !== "correct" && state.mode !== "training" && state.mode !== "survival") {
    fail("A partida já foi encerrada.");
  }
  if (state.outcome === "victory") fail("A partida já foi encerrada.");
  return {
    ...state,
    phase: "awaiting_choice",
    levelIndex: state.levelIndex + 1,
    question: next,
    choice: null,
    questionStartedAt: now,
    usedQuestionIds: [...state.usedQuestionIds, next.id],
    questionHelps: { eliminated: [], audience: null, card: null, hint: null, used: [] },
    reveal: null,
    outcome: null,
  };
}

/** Desistência antes de confirmar: recebe a premiação acumulada. */
export function walkaway(state: GameState): GameState {
  if (state.phase !== "awaiting_choice") fail("Só é possível desistir antes de confirmar a resposta.");
  if (state.mode === "training") return finish({ ...state, outcome: "walkaway" }, "walkaway", 0, "Você encerrou o treino.");
  const prize = prizeForCorrectCount(state.config.prizes, state.correctCount);
  return finish({ ...state, outcome: "walkaway" }, "walkaway", prize, "Você desistiu e levou sua premiação acumulada.");
}

export type RandomFn = () => number;

/** Usa uma ajuda, respeitando limite por partida e uma vez por pergunta. */
export function useHelp(
  state: GameState,
  type: HelpType,
  rng: RandomFn,
  payload: { index?: number } = {},
): { state: GameState; result: unknown } {
  if (state.phase !== "awaiting_choice") fail("Ajudas só podem ser usadas antes de confirmar a resposta.");
  const q = state.question;
  if (!q) fail("Nenhuma pergunta ativa.");
  const limit = state.config.helpLimits[type];
  if (state.helpsUsed[type] >= limit) fail("Você já utilizou todas as ajudas disponíveis deste tipo.");
  if (state.questionHelps.used.includes(type)) fail("Esta ajuda já foi usada nesta pergunta.");

  const qh = state.questionHelps;
  const wrong = OPTIONS.filter((o) => o !== q.correct);
  let result: unknown;
  let nextQh = { ...qh, used: [...qh.used, type] };
  let nextState: GameState = { ...state, helpsUsed: { ...state.helpsUsed, [type]: state.helpsUsed[type] + 1 } };

  switch (type) {
    case "cards": {
      const index = payload.index ?? -1;
      if (!Number.isInteger(index) || index < 0 || index > 3) fail("Escolha uma das quatro cartas.");
      const roll = rng();
      // Intensidade variável: a carta pode apontar com mais ou menos convicção.
      const intensity: "forte" | "media" | "fraca" = roll < 0.5 ? "forte" : roll < 0.8 ? "media" : "fraca";
      let option: Option;
      if (intensity === "forte") option = q.correct;
      else if (intensity === "media") option = rng() < 0.7 ? q.correct : pick(wrong, rng);
      else option = pick(OPTIONS.filter((o) => !qh.eliminated.includes(o)), rng);
      nextQh = { ...nextQh, card: { index, option, intensity } };
      result = nextQh.card;
      break;
    }
    case "fifty": {
      const candidates = wrong.filter((o) => !qh.eliminated.includes(o));
      const removeCount = Math.min(2, candidates.length);
      const removed = shuffle(candidates, rng).slice(0, removeCount);
      // Mantém sempre a correta: remove 2 erradas, deixando correta + 1 errada.
      nextQh = { ...nextQh, eliminated: [...qh.eliminated, ...removed] as Option[] };
      if (state.choice && nextQh.eliminated.includes(state.choice)) nextState = { ...nextState, choice: null };
      result = { eliminated: nextQh.eliminated };
      break;
    }
    case "audience": {
      const active = OPTIONS.filter((o) => !qh.eliminated.includes(o));
      const correctShare = 40 + Math.floor(rng() * 30); // 40% a 69%
      const rest = 100 - correctShare;
      const votes: Record<Option, number> = { A: 0, B: 0, C: 0, D: 0 };
      votes[q.correct] = correctShare;
      const others = active.filter((o) => o !== q.correct);
      let remaining = rest;
      others.forEach((o, i) => {
        const share = i === others.length - 1 ? remaining : Math.floor(rng() * (remaining + 1));
        votes[o] = share;
        remaining -= share;
      });
      nextQh = { ...nextQh, audience: votes };
      result = { votes, simulated: true };
      break;
    }
    case "presenter": {
      const hint = q.hint?.trim()
        ? q.hint
        : `Pense com calma sobre o tema "${q.category}" e descarte as alternativas que você já sabe que não batem com os fatos.`;
      nextQh = { ...nextQh, hint };
      result = { hint };
      break;
    }
  }

  return { state: { ...nextState, questionHelps: nextQh }, result };
}

export function pick<T>(items: T[], rng: RandomFn): T {
  if (items.length === 0) throw new GameRuleError("Lista vazia.");
  return items[Math.floor(rng() * items.length)];
}

export function shuffle<T>(items: T[], rng: RandomFn): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** PRNG determinístico (mulberry32) para o desafio diário. */
export function seededRandom(seed: string): RandomFn {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  let a = h >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type Candidate = { id: number; difficulty: Difficulty };

/**
 * Escolhe a próxima pergunta: mesma dificuldade-alvo, sem repetir as já usadas nesta partida
 * nem as já respondidas pelo jogador (quando possível). Faz fallback de dificuldade se necessário.
 */
export function pickNextQuestionId(
  candidates: Candidate[],
  target: Difficulty,
  excludeIds: Set<number>,
  rng: RandomFn,
): number | null {
  const order: Difficulty[] = [target, ...neighbours(target)];
  for (const d of order) {
    const pool = candidates.filter((c) => c.difficulty === d && !excludeIds.has(c.id));
    if (pool.length) return pick(pool, rng).id;
  }
  return null;
}

const SCALE: Difficulty[] = ["muito_facil", "facil", "intermediaria", "dificil", "muito_dificil", "especialista"];

function neighbours(d: Difficulty): Difficulty[] {
  const i = SCALE.indexOf(d);
  const out: Difficulty[] = [];
  for (let k = 1; k < SCALE.length; k++) {
    if (SCALE[i - k]) out.push(SCALE[i - k]);
    if (SCALE[i + k]) out.push(SCALE[i + k]);
  }
  return out;
}

/** Dificuldade-alvo para o nível atual (acima do último nível usa o último). */
export function targetDifficulty(levelDifficulty: Difficulty[], levelIndex: number): Difficulty {
  return levelDifficulty[Math.min(levelIndex, levelDifficulty.length - 1)] ?? "especialista";
}
