/**
 * Controle de qualidade do banco de perguntas (puro, sem I/O).
 * Formato de importação em texto (um registro por linha, campos separados por "|"):
 *   categoria|dificuldade|enunciado|A|B|C|D|correta|justificativa|fonte|tags
 * Dificuldades: muito_facil, facil, intermediaria, dificil, muito_dificil, especialista.
 */
import { DIFFICULTIES, type Difficulty } from "@/lib/config";
import { OPTIONS, type Option } from "@/lib/game/engine";

export type QuestionInput = {
  category: string;
  subcategory?: string;
  difficulty: string;
  statement: string;
  options: Record<Option, string>;
  correct: string;
  justification: string;
  source: string;
  tags?: string[];
  hint?: string;
  author?: string;
  license?: string;
};

export type ValidationResult = { errors: string[]; warnings: string[] };

/** Normaliza texto para comparação: minúsculas, sem acentos, sem pontuação. */
export function normalizeText(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Chave canônica usada para detectar perguntas duplicadas. */
export function questionKey(statement: string): string {
  return normalizeText(statement).slice(0, 380);
}

const AMBIGUOUS_OPTIONS = [
  "todas as anteriores",
  "nenhuma das anteriores",
  "todas estao corretas",
  "nenhuma esta correta",
  "todas estão corretas",
  "nenhuma está correta",
];

export function validateQuestion(q: QuestionInput): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const statement = (q.statement ?? "").trim();

  if (statement.length < 15) errors.push("Enunciado incompleto (mínimo de 15 caracteres).");
  if (statement.length > 500) errors.push("Enunciado longo demais (máximo de 500 caracteres).");
  if (!/[?.:]$/.test(statement)) errors.push("O enunciado deve terminar com pontuação de pergunta ou frase (?, . ou :).");
  if (!DIFFICULTIES.includes(q.difficulty as Difficulty)) errors.push(`Dificuldade inválida: ${q.difficulty}.`);
  if (!q.category || q.category.trim().length < 2) errors.push("Categoria obrigatória.");

  const values = OPTIONS.map((o) => (q.options?.[o] ?? "").trim());
  OPTIONS.forEach((o, i) => {
    if (!values[i]) errors.push(`Alternativa ${o} vazia.`);
    else if (values[i].length > 200) errors.push(`Alternativa ${o} longa demais.`);
  });
  const normalizedValues = values.map(normalizeText);
  if (new Set(normalizedValues).size !== normalizedValues.length) {
    errors.push("Alternativas repetidas ou equivalentes.");
  }
  if (normalizedValues.some((v) => AMBIGUOUS_OPTIONS.includes(v))) {
    errors.push("Alternativa ambígua (ex.: 'Todas as anteriores').");
  }
  if (!OPTIONS.includes(q.correct as Option)) {
    errors.push("Resposta correta deve ser A, B, C ou D (exatamente uma).");
  }
  // Alternativa muito parecida com o enunciado sugere pista óbvia ou erro de cadastro.
  const statementNorm = normalizeText(statement);
  if (normalizedValues.some((v) => v.length > 3 && v === statementNorm)) {
    errors.push("Uma alternativa é idêntica ao enunciado.");
  }

  if ((q.justification ?? "").trim().length < 20) {
    errors.push("Justificativa ausente ou insuficiente (resposta sem fundamentação).");
  }
  if (!(q.source ?? "").trim()) errors.push("Fonte de referência obrigatória.");
  // Marcadores de rascunho em maiúsculas ("TODO") ou texto de exemplo; "todo" em minúsculas é português comum.
  if (/\?\?|\bTODO\b|lorem ipsum/i.test(statement) && /\?\?|\bTODO\b/.test(statement) || /lorem ipsum/i.test(statement)) {
    errors.push("Enunciado com marcador de rascunho.");
  }
  if ((q.tags ?? []).length === 0) warnings.push("Sem tags: a busca e a seleção por tema ficam reduzidas.");
  return { errors, warnings };
}

/** Lê uma linha do formato de importação. Lança Error com a causa. */
export function parseQuestionLine(line: string): QuestionInput {
  const parts = line.split("|").map((p) => p.trim());
  if (parts.length !== 11) {
    throw new Error(`Esperados 11 campos separados por "|", encontrados ${parts.length}.`);
  }
  const [category, difficulty, statement, a, b, c, d, correct, justification, source, tags] = parts;
  return {
    category,
    difficulty,
    statement,
    options: { A: a, B: b, C: c, D: d },
    correct: correct.toUpperCase(),
    justification,
    source,
    tags: tags ? tags.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean) : [],
  };
}

/** Lê um bloco de texto completo, ignorando linhas vazias e comentários iniciados por "#". */
export function parseQuestionBlock(text: string): { items: QuestionInput[]; errors: { line: number; message: string }[] } {
  const items: QuestionInput[] = [];
  const errors: { line: number; message: string }[] = [];
  text.split(/\r?\n/).forEach((raw, idx) => {
    const line = raw.trim();
    if (!line || line.startsWith("#")) return;
    try {
      items.push(parseQuestionLine(line));
    } catch (e) {
      errors.push({ line: idx + 1, message: e instanceof Error ? e.message : "Linha inválida." });
    }
  });
  return { items, errors };
}

/** Detecta duplicidades dentro de um lote (além das já existentes no banco). */
export function findBatchDuplicates(items: QuestionInput[]): Map<number, number> {
  const seen = new Map<string, number>();
  const dup = new Map<number, number>();
  items.forEach((q, i) => {
    const key = questionKey(q.statement);
    if (seen.has(key)) dup.set(i, seen.get(key) as number);
    else seen.set(key, i);
  });
  return dup;
}
