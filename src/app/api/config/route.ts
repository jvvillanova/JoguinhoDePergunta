import { count, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { questions } from "@/db/schema";
import { ensureBankSeeded } from "@/lib/bank/service";
import { DIFFICULTY_LABELS, getConfig } from "@/lib/config";
import { errorResponse } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** Configuração pública: premiação, pontos de segurança, falas, limites de ajuda e categorias disponíveis. */
export async function GET() {
  try {
    await ensureBankSeeded();
    const cfg = await getConfig();
    const rows = await db
      .select({ category: questions.category, total: count(), difficulty: questions.difficulty })
      .from(questions)
      .where(eq(questions.active, true))
      .groupBy(questions.category, questions.difficulty);
    const [{ total }] = await db
      .select({ total: sql<number>`count(*)::int` })
      .from(questions)
      .where(eq(questions.active, true));
    const byCategory = new Map<string, number>();
    for (const r of rows) byCategory.set(r.category, (byCategory.get(r.category) ?? 0) + Number(r.total));
    return Response.json({
      prizes: cfg.prizes,
      safetyQuestions: cfg.safetyQuestions,
      levelDifficulty: cfg.levelDifficulty,
      helpLimits: cfg.helpLimits,
      timerSeconds: cfg.timerSeconds,
      quickQuestions: cfg.quickQuestions,
      survivalLives: cfg.survivalLives,
      specialPhrase: cfg.specialPhrase,
      phrases: cfg.phrases,
      difficultyLabels: DIFFICULTY_LABELS,
      totalQuestions: Number(total),
      categories: [...byCategory.entries()]
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => a.name.localeCompare(b.name, "pt-BR")),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
