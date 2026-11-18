import { errorResponse, HttpError, requireUser } from "@/lib/auth";
import { applyAction } from "@/lib/game/service";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f-]{36}$/i;

/**
 * Ações da partida: select | confirm | reveal | timeout | advance | help | walkaway.
 * O corpo pode conter `version` (controle otimista de concorrência).
 */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await ctx.params;
    if (!UUID_RE.test(id)) throw new HttpError(400, "Identificador de partida inválido.");
    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      throw new HttpError(400, "Corpo da requisição inválido.");
    }
    const result = await applyAction(user, id, {
      action: String(body.action ?? ""),
      version: typeof body.version === "number" ? body.version : undefined,
      option: typeof body.option === "string" ? body.option : undefined,
      type: typeof body.type === "string" ? body.type : undefined,
      index: typeof body.index === "number" ? body.index : undefined,
    });
    return Response.json(result);
  } catch (error) {
    return errorResponse(error);
  }
}
