import { errorResponse, requireUser } from "@/lib/auth";
import { getPlayerStats, getRanking } from "@/lib/stats";

export const dynamic = "force-dynamic";

/** Estatísticas do jogador autenticado e ranking público por maior premiação virtual. */
export async function GET() {
  try {
    const user = await requireUser();
    const [stats, ranking] = await Promise.all([getPlayerStats(user.id), getRanking()]);
    return Response.json({ user, stats, ranking });
  } catch (error) {
    return errorResponse(error);
  }
}
