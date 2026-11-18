import type { QuestionInput } from "./quality";

/** Normaliza o corpo JSON enviado pelo painel administrativo para o formato de QuestionInput. */
export function toQuestionInput(b: Record<string, unknown>): QuestionInput {
  const o = (typeof b.options === "object" && b.options !== null ? b.options : {}) as Record<string, unknown>;
  const rawTags = Array.isArray(b.tags) ? b.tags.map((t) => String(t)) : String(b.tags ?? "").split(",");
  return {
    category: String(b.category ?? "").trim(),
    subcategory: String(b.subcategory ?? "").trim(),
    difficulty: String(b.difficulty ?? "").trim(),
    statement: String(b.statement ?? "").trim(),
    options: {
      A: String(o.A ?? "").trim(),
      B: String(o.B ?? "").trim(),
      C: String(o.C ?? "").trim(),
      D: String(o.D ?? "").trim(),
    },
    correct: String(b.correct ?? "").trim().toUpperCase(),
    justification: String(b.justification ?? "").trim(),
    source: String(b.source ?? "").trim(),
    hint: String(b.hint ?? "").trim(),
    tags: rawTags.map((t) => t.trim().toLowerCase()).filter(Boolean),
    author: typeof b.author === "string" && b.author.trim() ? b.author.trim() : undefined,
  };
}
