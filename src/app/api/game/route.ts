import { errorResponse, HttpError, requireUser } from "@/lib/auth";
import { dailyStatus, getActiveGame, startGame } from "@/lib/game/service";

export const dynamic = "force-dynamic";

/** Retorna a partida em andamento (para recuperação após atualização da página) e o status do desafio diário. */
export async function GET() {
  try {
    const user = await requireUser();
    const [active, daily] = await Promise.all([getActiveGame(user), dailyStatus(user)]);
    return Response.json({ active, daily });
  } catch (error) {
    return errorResponse(error);
  }
}

/** Inicia uma nova partida no modo escolhido. */
export async function POST(request: Request) {
  try {
    const user = await requireUser();
    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      throw new HttpError(400, "Corpo da requisição inválido.");
    }
    const categories = Array.isArray(body.categories)
      ? body.categories.map((c) => String(c)).slice(0, 30)
      : null;
    const result = await startGame(user, {
      mode: String(body.mode ?? ""),
      categories,
      replace: body.replace === true,
    });
    return Response.json(result, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
