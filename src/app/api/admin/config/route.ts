import { errorResponse, HttpError, requireAdmin } from "@/lib/auth";
import { DEFAULT_CONFIG, getConfig, saveConfig, type GameConfig } from "@/lib/config";

export const dynamic = "force-dynamic";

/** Lê a configuração atual (premiação, segurança, ajudas, falas, modos). */
export async function GET() {
  try {
    await requireAdmin();
    return Response.json({ config: await getConfig(), defaults: DEFAULT_CONFIG });
  } catch (error) {
    return errorResponse(error);
  }
}

/** Salva a configuração após validação estrita no servidor. */
export async function PUT(request: Request) {
  try {
    await requireAdmin();
    const body = (await request.json().catch(() => {
      throw new HttpError(400, "Corpo da requisição inválido.");
    })) as Partial<GameConfig>;
    const merged: GameConfig = {
      ...DEFAULT_CONFIG,
      ...body,
      prizes: (body.prizes ?? []).map((n) => Number(n)),
      safetyQuestions: (body.safetyQuestions ?? []).map((n) => Number(n)),
      levelDifficulty: body.levelDifficulty ?? DEFAULT_CONFIG.levelDifficulty,
      helpLimits: { ...DEFAULT_CONFIG.helpLimits, ...(body.helpLimits ?? {}) },
      timerSeconds: Number(body.timerSeconds ?? 0),
      quickQuestions: Number(body.quickQuestions ?? DEFAULT_CONFIG.quickQuestions),
      survivalLives: Number(body.survivalLives ?? DEFAULT_CONFIG.survivalLives),
      phrases: { ...DEFAULT_CONFIG.phrases, ...(body.phrases ?? {}) },
      specialPhrase: String(body.specialPhrase ?? DEFAULT_CONFIG.specialPhrase).slice(0, 200),
    };
    try {
      const saved = await saveConfig(merged);
      return Response.json({ config: saved });
    } catch (err) {
      throw new HttpError(422, err instanceof Error ? err.message : "Configuração inválida.");
    }
  } catch (error) {
    return errorResponse(error);
  }
}
