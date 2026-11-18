import { eq } from "drizzle-orm";
import { db } from "@/db";
import { questions } from "@/db/schema";
import { errorResponse, HttpError, requireAdmin } from "@/lib/auth";
import { toQuestionInput } from "@/lib/bank/input";
import { questionKey, validateQuestion } from "@/lib/bank/quality";

export const dynamic = "force-dynamic";

async function loadId(ctx: { params: Promise<{ id: string }> }): Promise<number> {
  const { id } = await ctx.params;
  const n = Number(id);
  if (!Number.isInteger(n) || n <= 0) throw new HttpError(400, "Identificador inválido.");
  return n;
}

/** Edição completa com revalidação. Permite aprovar (active/validationStatus) perguntas geradas por IA. */
export async function PUT(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin();
    const id = await loadId(ctx);
    const body = (await request.json().catch(() => {
      throw new HttpError(400, "Corpo da requisição inválido.");
    })) as Record<string, unknown>;
    const input = toQuestionInput(body);
    const { errors, warnings } = validateQuestion(input);
    if (errors.length) return Response.json({ error: "Pergunta reprovada na validação.", errors, warnings }, { status: 422 });

    const existing = await db.select({ id: questions.id, status: questions.validationStatus }).from(questions).where(eq(questions.id, id)).limit(1);
    if (!existing[0]) throw new HttpError(404, "Pergunta não encontrada.");

    const requestedStatus = typeof body.validationStatus === "string" ? body.validationStatus : "revisao_humana";
    try {
      await db
        .update(questions)
        .set({
          statement: input.statement,
          normalizedKey: questionKey(input.statement),
          category: input.category,
          subcategory: input.subcategory ?? "",
          difficulty: input.difficulty,
          optionA: input.options.A,
          optionB: input.options.B,
          optionC: input.options.C,
          optionD: input.options.D,
          correctOption: input.correct,
          justification: input.justification,
          hint: input.hint ?? "",
          source: input.source,
          tags: input.tags ?? [],
          verifiedAt: new Date().toISOString().slice(0, 10),
          validationStatus: requestedStatus,
          active: body.active !== false,
          author: existing[0].status === "aguardando_aprovacao" ? admin.username : undefined,
        })
        .where(eq(questions.id, id));
    } catch (err) {
      if (typeof err === "object" && err !== null && (err as { code?: string }).code === "23505") {
        throw new HttpError(409, "Já existe outra pergunta com este enunciado.");
      }
      throw err;
    }
    return Response.json({ ok: true, warnings });
  } catch (error) {
    return errorResponse(error);
  }
}

/**
 * Exclusão. Perguntas nunca respondidas são removidas; perguntas já utilizadas em partidas
 * são desativadas (preserva o histórico e as estatísticas).
 */
export async function DELETE(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin();
    const id = await loadId(ctx);
    const rows = await db.select({ timesAsked: questions.timesAsked }).from(questions).where(eq(questions.id, id)).limit(1);
    if (!rows[0]) throw new HttpError(404, "Pergunta não encontrada.");
    if (rows[0].timesAsked > 0) {
      await db.update(questions).set({ active: false }).where(eq(questions.id, id));
      return Response.json({ ok: true, mode: "desativada" });
    }
    await db.delete(questions).where(eq(questions.id, id));
    return Response.json({ ok: true, mode: "excluida" });
  } catch (error) {
    return errorResponse(error);
  }
}
