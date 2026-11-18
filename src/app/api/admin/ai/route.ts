import { eq } from "drizzle-orm";
import { db } from "@/db";
import { questions } from "@/db/schema";
import { errorResponse, HttpError, requireAdmin } from "@/lib/auth";
import { importQuestions } from "@/lib/bank/service";
import { aiStatus, generateQuestions, reviewQuestion } from "@/lib/ai";
import { toQuestionInput } from "@/lib/bank/input";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireAdmin();
    return Response.json(aiStatus());
  } catch (error) {
    return errorResponse(error);
  }
}

/**
 * generate: cria perguntas com IA como INATIVAS e "aguardando_aprovacao".
 * review: pede à IA uma revisão de uma pergunta existente (apenas sugestão para o humano).
 */
export async function POST(request: Request) {
  try {
    const admin = await requireAdmin();
    const body = (await request.json().catch(() => {
      throw new HttpError(400, "Corpo da requisição inválido.");
    })) as Record<string, unknown>;
    const action = String(body.action ?? "");

    if (action === "generate") {
      const generated = await generateQuestions({
        category: String(body.category ?? "").trim(),
        difficulty: String(body.difficulty ?? ""),
        count: Number(body.count ?? 5),
        topic: typeof body.topic === "string" ? body.topic : undefined,
      });
      const report = await importQuestions(generated, {
        status: "aguardando_aprovacao",
        author: `IA revisada por ${admin.username}`,
        active: false,
      });
      return Response.json({ generated: generated.length, report }, { status: 201 });
    }

    if (action === "review") {
      const id = Number(body.id);
      const rows = await db.select().from(questions).where(eq(questions.id, id)).limit(1);
      const row = rows[0];
      if (!row) throw new HttpError(404, "Pergunta não encontrada.");
      const input = toQuestionInput({
        ...row,
        options: { A: row.optionA, B: row.optionB, C: row.optionC, D: row.optionD },
        correct: row.correctOption,
      });
      const review = await reviewQuestion(input);
      return Response.json({ review, note: "A revisão da IA é uma sugestão; a decisão final é humana." });
    }

    throw new HttpError(400, "Ação de IA desconhecida.");
  } catch (error) {
    return errorResponse(error);
  }
}
