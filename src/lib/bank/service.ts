import { and, count, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { answerLog, questions } from "@/db/schema";
import type { Difficulty } from "@/lib/config";
import type { Candidate, QuestionSecret } from "@/lib/game/engine";
import { OPTIONS, type Option } from "@/lib/game/engine";
import {
  findBatchDuplicates,
  parseQuestionBlock,
  questionKey,
  validateQuestion,
  type QuestionInput,
} from "./quality";
import { BANK_BLOCKS } from "@/data/bank";

export type ImportReport = {
  inserted: number;
  duplicates: { index: number; statement: string; reason: string }[];
  rejected: { index: number; statement: string; errors: string[] }[];
  warnings: { index: number; statement: string; warnings: string[] }[];
  parseErrors: { line: number; message: string }[];
};

const today = () => new Date().toISOString().slice(0, 10);

/**
 * Importa perguntas somente após validação. Duplicadas (no lote ou no banco) são descartadas.
 * `status` indica o resultado da curadoria: "validacao_automatica", "revisao_humana" ou "pendente".
 */
export async function importQuestions(
  items: QuestionInput[],
  opts: { status: string; author?: string; source?: "import" | "ai" | "manual"; active?: boolean },
): Promise<ImportReport> {
  const report: ImportReport = { inserted: 0, duplicates: [], rejected: [], warnings: [], parseErrors: [] };
  const batchDup = findBatchDuplicates(items);
  const validRows: (typeof questions.$inferInsert)[] = [];

  items.forEach((q, index) => {
    if (batchDup.has(index)) {
      report.duplicates.push({ index, statement: q.statement, reason: "Duplicada dentro do lote." });
      return;
    }
    const { errors, warnings } = validateQuestion(q);
    if (errors.length) {
      report.rejected.push({ index, statement: q.statement, errors });
      return;
    }
    if (warnings.length) report.warnings.push({ index, statement: q.statement, warnings });
    validRows.push({
      statement: q.statement.trim(),
      normalizedKey: questionKey(q.statement),
      category: q.category.trim(),
      subcategory: (q.subcategory ?? "").trim(),
      difficulty: q.difficulty,
      optionA: q.options.A.trim(),
      optionB: q.options.B.trim(),
      optionC: q.options.C.trim(),
      optionD: q.options.D.trim(),
      correctOption: q.correct.toUpperCase(),
      justification: q.justification.trim(),
      hint: (q.hint ?? "").trim(),
      source: q.source.trim(),
      verifiedAt: today(),
      author: q.author ?? opts.author ?? "equipe",
      validationStatus: opts.status,
      tags: (q.tags ?? []).map((t) => t.toLowerCase()),
      license: q.license ?? "Original do projeto",
      active: opts.active ?? true,
    });
  });

  // Insere em lotes; ON CONFLICT protege contra duplicidade com o banco existente.
  for (let i = 0; i < validRows.length; i += 200) {
    const chunk = validRows.slice(i, i + 200);
    const inserted = await db
      .insert(questions)
      .values(chunk)
      .onConflictDoNothing({ target: questions.normalizedKey })
      .returning({ statement: questions.statement });
    report.inserted += inserted.length;
    const insertedSet = new Set(inserted.map((r) => r.statement));
    for (const row of chunk) {
      if (!insertedSet.has(row.statement)) {
        report.duplicates.push({ index: -1, statement: row.statement, reason: "Já existe no banco oficial." });
      }
    }
  }
  return report;
}

export async function parseAndImport(text: string, status: string): Promise<ImportReport> {
  const { items, errors } = parseQuestionBlock(text);
  const report = await importQuestions(items, { status });
  report.parseErrors = errors;
  return report;
}

let seedPromise: Promise<void> | null = null;

/** Semeia o banco a partir dos blocos versionados em src/data/bank, uma única vez por processo. */
export function ensureBankSeeded(): Promise<void> {
  if (!seedPromise) {
    seedPromise = (async () => {
      const [{ total }] = await db.select({ total: count() }).from(questions);
      if (Number(total) > 0) return;
      for (const block of BANK_BLOCKS) {
        await parseAndImport(block, "validacao_automatica");
      }
    })().catch((err) => {
      seedPromise = null;
      throw err;
    });
  }
  return seedPromise;
}

export async function activeCandidates(categories: string[] | null): Promise<Candidate[]> {
  const conditions = [eq(questions.active, true)];
  if (categories && categories.length) conditions.push(inArray(questions.category, categories));
  const rows = await db
    .select({ id: questions.id, difficulty: questions.difficulty })
    .from(questions)
    .where(and(...conditions));
  return rows.map((r) => ({ id: r.id, difficulty: r.difficulty as Difficulty }));
}

export async function seenQuestionIds(userId: number): Promise<Set<number>> {
  const rows = await db
    .selectDistinct({ questionId: answerLog.questionId })
    .from(answerLog)
    .where(eq(answerLog.userId, userId));
  return new Set(rows.map((r) => r.questionId));
}

export async function loadQuestionSecret(id: number): Promise<QuestionSecret | null> {
  const rows = await db.select().from(questions).where(eq(questions.id, id)).limit(1);
  const r = rows[0];
  if (!r) return null;
  return {
    id: r.id,
    statement: r.statement,
    options: { A: r.optionA, B: r.optionB, C: r.optionC, D: r.optionD },
    category: r.category,
    difficulty: r.difficulty as Difficulty,
    correct: r.correctOption as Option,
    justification: r.justification,
    source: r.source,
    hint: r.hint,
  };
}

/** Registra estatísticas de uso da pergunta (acertos/tentativas) sem bloquear a partida. */
export async function recordQuestionStat(id: number, correct: boolean): Promise<void> {
  await db
    .update(questions)
    .set({
      timesAsked: sql`${questions.timesAsked} + 1`,
      timesCorrect: sql`${questions.timesCorrect} + ${correct ? 1 : 0}`,
    })
    .where(eq(questions.id, id));
}

export function isOption(value: unknown): value is Option {
  return typeof value === "string" && (OPTIONS as readonly string[]).includes(value);
}
