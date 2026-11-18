/**
 * Estatísticas do jogador e ranking. Calculadas no servidor a partir de partidas
 * finalizadas (tabela games) e respostas registradas (tabela answer_log).
 */
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { answerLog, games, questions, users } from "@/db/schema";

export async function getPlayerStats(userId: number) {
  const outcome = sql<string>`${games.state}->>'outcome'`;
  const finished = await db
    .select({
      id: games.id,
      mode: games.mode,
      prize: games.prize,
      correctCount: games.correctCount,
      outcome,
      endedAt: games.endedAt,
      startedAt: games.startedAt,
    })
    .from(games)
    .where(and(eq(games.userId, userId), eq(games.status, "finished")))
    .orderBy(desc(games.endedAt))
    .limit(300);

  const totals = {
    matches: finished.length,
    victories: finished.filter((g) => g.outcome === "victory").length,
    defeats: finished.filter((g) => g.outcome === "defeat").length,
    walkaways: finished.filter((g) => g.outcome === "walkaway").length,
    accumulatedPrize: finished.reduce((s, g) => s + Number(g.prize), 0),
    bestPrize: finished.reduce((m, g) => Math.max(m, Number(g.prize)), 0),
  };

  const [answers] = await db
    .select({
      total: sql<number>`count(*)::int`,
      correct: sql<number>`count(*) filter (where ${answerLog.correct})::int`,
      avgMs: sql<number>`coalesce(round(avg(${answerLog.responseMs})), 0)::int`,
    })
    .from(answerLog)
    .where(eq(answerLog.userId, userId));

  const perCategory = await db
    .select({
      category: questions.category,
      total: sql<number>`count(*)::int`,
      correct: sql<number>`count(*) filter (where ${answerLog.correct})::int`,
    })
    .from(answerLog)
    .innerJoin(questions, eq(questions.id, answerLog.questionId))
    .where(eq(answerLog.userId, userId))
    .groupBy(questions.category);

  const rated = perCategory
    .filter((c) => c.total >= 3)
    .map((c) => ({ category: c.category, total: c.total, rate: Math.round((c.correct / c.total) * 100) }))
    .sort((a, b) => b.rate - a.rate);

  const totalAnswers = Number(answers?.total ?? 0);
  const correctAnswers = Number(answers?.correct ?? 0);

  return {
    totals,
    answers: {
      total: totalAnswers,
      correct: correctAnswers,
      accuracy: totalAnswers ? Math.round((correctAnswers / totalAnswers) * 100) : 0,
      avgResponseMs: Number(answers?.avgMs ?? 0),
    },
    bestCategories: rated.slice(0, 3),
    hardestCategories: [...rated].reverse().slice(0, 3),
    evolution: [...finished]
      .reverse()
      .slice(-30)
      .map((g) => ({
        endedAt: g.endedAt,
        prize: Number(g.prize),
        correct: g.correctCount,
        outcome: g.outcome,
        mode: g.mode,
      })),
    history: finished.slice(0, 25),
  };
}

export async function getRanking(limit = 10) {
  const rows = await db
    .select({
      username: users.username,
      best: sql<number>`max(${games.prize})::int`,
      matches: sql<number>`count(*)::int`,
    })
    .from(games)
    .innerJoin(users, eq(users.id, games.userId))
    .where(eq(games.status, "finished"))
    .groupBy(users.username)
    .orderBy(desc(sql`max(${games.prize})`))
    .limit(limit);
  return rows.map((r, i) => ({ position: i + 1, username: r.username, best: Number(r.best), matches: Number(r.matches) }));
}
