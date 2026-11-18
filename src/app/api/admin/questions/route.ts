import { and, asc, count, desc, eq, ilike, sql } from "drizzle-orm";
import { db } from "@/db";
import { games, questions, sessions, users } from "@/db/schema";
import { errorResponse, HttpError, requireAdmin } from "@/lib/auth";
import { importQuestions, parseAndImport } from "@/lib/bank/service";
import { toQuestionInput } from "@/lib/bank/input";
import { parseQuestionBlock, validateQuestion } from "@/lib/bank/quality";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 25;

function toRow(r: typeof questions.$inferSelect) {
  return {
    id: r.id,
    statement: r.statement,
    category: r.category,
    subcategory: r.subcategory,
    difficulty: r.difficulty,
    options: { A: r.optionA, B: r.optionB, C: r.optionC, D: r.optionD },
    correct: r.correctOption,
    justification: r.justification,
    hint: r.hint,
    source: r.source,
    verifiedAt: r.verifiedAt,
    author: r.author,
    validationStatus: r.validationStatus,
    tags: r.tags,
    language: r.language,
    license: r.license,
    active: r.active,
    timesAsked: r.timesAsked,
    timesCorrect: r.timesCorrect,
  };
}

/** Listagem com filtros, painel de visão geral, duplicadas e exportação. */
export async function GET(request: Request) {
  try {
    await requireAdmin();
    const url = new URL(request.url);
    const view = url.searchParams.get("view") ?? "list";

    if (view === "overview") {
      const [totals] = await db
        .select({
          total: count(),
          active: sql<number>`count(*) filter (where ${questions.active})::int`,
          pending: sql<number>`count(*) filter (where ${questions.validationStatus} = 'aguardando_aprovacao')::int`,
        })
        .from(questions);
      const byDifficulty = await db
        .select({ key: questions.difficulty, total: count() })
        .from(questions)
        .where(eq(questions.active, true))
        .groupBy(questions.difficulty);
      const byCategory = await db
        .select({ key: questions.category, total: count() })
        .from(questions)
        .where(eq(questions.active, true))
        .groupBy(questions.category)
        .orderBy(asc(questions.category));
      const [{ players }] = await db.select({ players: sql<number>`count(*)::int` }).from(users);
      const [{ finished }] = await db
        .select({ finished: sql<number>`count(*)::int` })
        .from(games)
        .where(eq(games.status, "finished"));
      const [{ openSessions }] = await db
        .select({ openSessions: sql<number>`count(*)::int` })
        .from(sessions);
      return Response.json({
        totals: { ...totals, total: Number(totals.total) },
        byDifficulty,
        byCategory,
        players,
        finishedGames: finished,
        openSessions,
      });
    }

    if (view === "duplicates") {
      // Possíveis duplicatas: mesmo início de enunciado normalizado (chave de 60 caracteres).
      const rows = await db
        .select()
        .from(questions)
        .where(
          sql`left(${questions.normalizedKey}, 60) in (select left(normalized_key, 60) from questions group by 1 having count(*) > 1)`,
        )
        .orderBy(asc(questions.normalizedKey))
        .limit(500);
      const groups = new Map<string, ReturnType<typeof toRow>[]>();
      for (const r of rows) {
        const k = r.normalizedKey.slice(0, 60);
        groups.set(k, [...(groups.get(k) ?? []), toRow(r)]);
      }
      return Response.json({ groups: [...groups.values()] });
    }

    if (view === "export") {
      const format = url.searchParams.get("format") === "txt" ? "txt" : "json";
      const rows = await db.select().from(questions).orderBy(asc(questions.id));
      if (format === "json") {
        return new Response(JSON.stringify(rows.map(toRow), null, 2), {
          headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Content-Disposition": 'attachment; filename="banco-perguntas.json"',
          },
        });
      }
      const lines = rows
        .filter((r) => r.active)
        .map((r) =>
          [r.category, r.difficulty, r.statement, r.optionA, r.optionB, r.optionC, r.optionD, r.correctOption, r.justification, r.source, r.tags.join(",")]
            .map((f) => String(f).replace(/\|/g, "/"))
            .join("|"),
        );
      return new Response(lines.join("\n") + "\n", {
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Content-Disposition": 'attachment; filename="banco-perguntas.txt"',
        },
      });
    }

    // Listagem paginada com filtros.
    const conditions = [];
    const q = url.searchParams.get("q")?.trim();
    if (q) conditions.push(ilike(questions.statement, `%${q.replace(/[%_]/g, "")}%`));
    const category = url.searchParams.get("category");
    if (category) conditions.push(eq(questions.category, category));
    const difficulty = url.searchParams.get("difficulty");
    if (difficulty) conditions.push(eq(questions.difficulty, difficulty));
    const status = url.searchParams.get("status");
    if (status) conditions.push(eq(questions.validationStatus, status));
    const active = url.searchParams.get("active");
    if (active === "1" || active === "0") conditions.push(eq(questions.active, active === "1"));
    const page = Math.max(1, Number(url.searchParams.get("page") ?? 1) || 1);
    const where = conditions.length ? and(...conditions) : undefined;

    const [{ total }] = await db.select({ total: count() }).from(questions).where(where);
    const rows = await db
      .select()
      .from(questions)
      .where(where)
      .orderBy(desc(questions.id))
      .limit(PAGE_SIZE)
      .offset((page - 1) * PAGE_SIZE);
    return Response.json({ items: rows.map(toRow), total: Number(total), page, pageSize: PAGE_SIZE });
  } catch (error) {
    return errorResponse(error);
  }
}

/** Criação manual de pergunta ou importação em lote (action: "create" | "import" | "validate"). */
export async function POST(request: Request) {
  try {
    const admin = await requireAdmin();
    const body = (await request.json().catch(() => {
      throw new HttpError(400, "Corpo da requisição inválido.");
    })) as Record<string, unknown>;
    const action = String(body.action ?? "create");

    if (action === "import") {
      const text = String(body.text ?? "");
      if (text.trim().length < 10) throw new HttpError(400, "Informe o conteúdo a importar.");
      const report = await parseAndImport(text, "revisao_humana");
      return Response.json({ report });
    }

    if (action === "validate") {
      const { items, errors } = parseQuestionBlock(String(body.text ?? ""));
      const checks = items.map((it, index) => ({ index, statement: it.statement, ...validateQuestion(it) }));
      return Response.json({ parseErrors: errors, checks });
    }

    const input = toQuestionInput(body);
    const { errors, warnings } = validateQuestion(input);
    if (errors.length) return Response.json({ error: "Pergunta reprovada na validação.", errors, warnings }, { status: 422 });
    const report = await importQuestions([input], {
      status: "revisao_humana",
      author: admin.username,
      active: body.active !== false,
    });
    if (report.inserted === 0) {
      throw new HttpError(409, "Pergunta duplicada: já existe uma pergunta equivalente no banco.");
    }
    return Response.json({ report, warnings }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
