/**
 * Orquestração das partidas no banco. Toda transição ocorre dentro de uma transação
 * com bloqueio de linha (SELECT ... FOR UPDATE) e verificação de versão, o que impede
 * processamento duplicado de cliques, abas concorrentes e estados obsoletos.
 */
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { answerLog, dailyResults, games } from "@/db/schema";
import { getConfig, type GameConfig } from "@/lib/config";
import {
  activeCandidates,
  ensureBankSeeded,
  loadQuestionSecret,
  recordQuestionStat,
  seenQuestionIds,
} from "@/lib/bank/service";
import { HttpError, type SessionUser } from "@/lib/auth";
import * as engine from "./engine";
import type { GameState, HelpType, Mode, Option } from "./engine";

export const PLAYABLE_MODES: Mode[] = ["classic", "infinite", "quick", "survival", "categories", "training", "daily"];
export const HELP_TYPES: HelpType[] = ["cards", "fifty", "audience", "presenter"];
const ACTIONS = ["select", "confirm", "reveal", "timeout", "advance", "help", "walkaway"] as const;
export type GameAction = (typeof ACTIONS)[number];

type TxClient = Parameters<Parameters<typeof db.transaction>[0]>[0];

const todayUtc = () => new Date().toISOString().slice(0, 10);

function snapshotConfig(cfg: GameConfig, mode: Mode): engine.GameConfigSnapshot {
  const quickLength = mode === "quick" ? cfg.quickQuestions : mode === "daily" ? 5 : null;
  const safetyModes: Mode[] = ["classic", "infinite", "categories"];
  return {
    prizes: cfg.prizes,
    safetyQuestions: safetyModes.includes(mode) ? cfg.safetyQuestions : [],
    helpLimits: { ...cfg.helpLimits },
    timerSeconds: cfg.timerSeconds,
    maxQuestions: quickLength,
    lives: mode === "survival" ? cfg.survivalLives : null,
    specialPhrase: cfg.specialPhrase,
  };
}

/** Escolhe e carrega a próxima pergunta, respeitando dificuldade-alvo e não repetição. */
async function chooseQuestion(
  state: Pick<GameState, "mode" | "levelIndex" | "usedQuestionIds" | "categories" | "dailyDay" | "config">,
  userId: number,
  cfgLevels: GameConfig["levelDifficulty"],
) {
  const candidates = await activeCandidates(state.categories);
  const target = engine.targetDifficulty(cfgLevels, state.levelIndex);
  const used = new Set(state.usedQuestionIds);
  const isDaily = state.mode === "daily";
  const rng = isDaily ? engine.seededRandom(`${state.dailyDay}:${state.levelIndex + 1}`) : Math.random;
  // Perguntas já respondidas pelo jogador são evitadas quando há alternativas.
  const seen = isDaily ? new Set<number>() : await seenQuestionIds(userId);
  const exclude = new Set([...used, ...seen]);
  const id =
    engine.pickNextQuestionId(candidates, target, exclude, rng) ??
    engine.pickNextQuestionId(candidates, target, used, rng);
  if (id === null) return null;
  return loadQuestionSecret(id);
}

export async function startGame(
  user: SessionUser,
  input: { mode: string; categories?: string[] | null; replace?: boolean },
) {
  await ensureBankSeeded();
  const mode = input.mode as Mode;
  if (!PLAYABLE_MODES.includes(mode)) throw new HttpError(400, "Modo de jogo inválido.");
  const cfg = await getConfig();
  const categories = mode === "categories" ? (input.categories ?? []).filter(Boolean) : null;
  if (mode === "categories" && (!categories || categories.length === 0)) {
    throw new HttpError(400, "Escolha ao menos uma categoria.");
  }

  const day = todayUtc();
  if (mode === "daily") {
    const played = await db
      .select({ id: dailyResults.id })
      .from(dailyResults)
      .where(and(eq(dailyResults.userId, user.id), eq(dailyResults.day, day)))
      .limit(1);
    if (played.length) throw new HttpError(409, "Você já participou do desafio diário de hoje.");
  }

  const active = await db
    .select({ id: games.id })
    .from(games)
    .where(and(eq(games.userId, user.id), eq(games.status, "active")));
  if (active.length) {
    if (!input.replace) throw new HttpError(409, "Você já tem uma partida em andamento.");
    await db.update(games).set({ status: "abandoned", endedAt: new Date() }).where(eq(games.userId, user.id));
  }

  const snapshot = snapshotConfig(cfg, mode);
  const base = { mode, config: snapshot, levelIndex: 0, usedQuestionIds: [], categories, dailyDay: mode === "daily" ? day : null };
  const question = await chooseQuestion(
    { ...base, usedQuestionIds: [] } as Parameters<typeof chooseQuestion>[0],
    user.id,
    cfg.levelDifficulty,
  );
  if (!question) throw new HttpError(503, "Não há perguntas disponíveis para esta configuração.");

  const state = engine.createState({
    mode,
    config: snapshot,
    question,
    categories,
    dailyDay: base.dailyDay,
    now: Date.now(),
  });
  const id = randomUUID();
  await db.insert(games).values({
    id,
    userId: user.id,
    mode,
    status: "active",
    phase: state.phase,
    version: 0,
    state: state as unknown as Record<string, unknown>,
    prize: 0,
    correctCount: 0,
  });
  return { gameId: id, version: 0, game: engine.publicView(state) };
}

export async function getActiveGame(user: SessionUser) {
  const rows = await db
    .select()
    .from(games)
    .where(and(eq(games.userId, user.id), eq(games.status, "active")))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return { gameId: row.id, version: row.version, game: engine.publicView(row.state as unknown as GameState) };
}

async function logAnswer(tx: TxClient, user: SessionUser, gameId: string, state: GameState) {
  const q = state.question;
  if (!q || !state.reveal) return;
  const responseMs = state.lockedAt ? Math.max(0, state.lockedAt - state.questionStartedAt) : 0;
  await tx.insert(answerLog).values({
    gameId,
    userId: user.id,
    questionId: q.id,
    chosen: state.choice ?? "-",
    correct: state.reveal.isCorrect,
    responseMs,
  });
  await recordQuestionStat(q.id, state.reveal.isCorrect);
}

/**
 * Executa uma ação da máquina de estados. Retorna o estado público atualizado.
 */
export async function applyAction(
  user: SessionUser,
  gameId: string,
  body: { action: string; version?: number; option?: string; type?: string; index?: number },
) {
  if (!ACTIONS.includes(body.action as GameAction)) throw new HttpError(400, "Ação desconhecida.");
  const action = body.action as GameAction;

  return db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(games)
      .where(and(eq(games.id, gameId), eq(games.userId, user.id)))
      .for("update")
      .limit(1);
    const row = rows[0];
    if (!row) throw new HttpError(404, "Partida não encontrada.");
    if (row.status !== "active") throw new HttpError(409, "Esta partida já foi encerrada.");
    if (body.version !== undefined && body.version !== row.version) {
      throw new HttpError(409, "A partida foi atualizada em outra janela. Recarregando o estado.");
    }

    let state = row.state as unknown as GameState;
    const before = state.phase;
    const now = Date.now();
    let result: unknown = null;

    switch (action) {
      case "select":
        if (!body.option) throw new HttpError(400, "Alternativa obrigatória.");
        state = engine.selectOption(state, body.option as Option);
        break;
      case "confirm":
        state = engine.confirmChoice(state, now);
        break;
      case "timeout":
        if (!engine.timerExpired(state, now)) throw new HttpError(409, "O tempo ainda não esgotou.");
        state = engine.resolveTimeout(state);
        break;
      case "reveal":
        // Idempotente: revelar novamente não reprocessa a resposta.
        state = engine.reveal(state);
        break;
      case "advance": {
        if (state.phase !== "revealed") throw new HttpError(409, "A próxima pergunta só surge após a revelação.");
        const cfg = await getConfig();
        const next = await chooseQuestion(
          { ...state, levelIndex: state.levelIndex + 1 },
          user.id,
          cfg.levelDifficulty,
        );
        if (!next) {
          state = {
            ...state,
            phase: "finished",
            outcome: "walkaway",
            finalPrize: engine.prizeForCorrectCount(state.config.prizes, state.correctCount),
            prize: engine.prizeForCorrectCount(state.config.prizes, state.correctCount),
            endReason: "O banco de perguntas se esgotou para esta configuração.",
          };
        } else {
          state = engine.advance(state, next, now);
        }
        break;
      }
      case "help": {
        if (!body.type || !HELP_TYPES.includes(body.type as HelpType)) throw new HttpError(400, "Ajuda inválida.");
        const r = engine.useHelp(state, body.type as HelpType, Math.random, { index: body.index });
        state = r.state;
        result = r.result;
        break;
      }
      case "walkaway":
        state = engine.walkaway(state);
        break;
    }

    // Registro de resposta somente na transição de travada/revelada para revelada (uma única vez).
    if (before !== "revealed" && before !== "finished" && (state.phase === "revealed" || state.phase === "finished") && state.reveal) {
      await logAnswer(tx, user, gameId, state);
    }

    const finished = state.phase === "finished";
    const version = row.version + 1;
    await tx
      .update(games)
      .set({
        state: state as unknown as Record<string, unknown>,
        phase: state.phase,
        version,
        prize: state.finalPrize ?? state.prize,
        correctCount: state.correctCount,
        status: finished ? "finished" : "active",
        endedAt: finished ? new Date() : null,
      })
      .where(eq(games.id, gameId));

    if (finished && state.mode === "daily" && state.dailyDay) {
      await tx
        .insert(dailyResults)
        .values({
          userId: user.id,
          day: state.dailyDay,
          correctCount: state.correctCount,
          total: state.config.maxQuestions ?? 5,
        })
        .onConflictDoNothing();
    }

    return { gameId, version, result, game: engine.publicView(state) };
  });
}

export async function dailyStatus(user: SessionUser) {
  const day = todayUtc();
  const rows = await db
    .select()
    .from(dailyResults)
    .where(and(eq(dailyResults.userId, user.id), eq(dailyResults.day, day)))
    .limit(1);
  return { day, played: rows.length > 0, result: rows[0] ?? null };
}

