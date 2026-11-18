"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { DEFAULT_AUDIO, getStudio, loadAudioSettings, saveAudioSettings, type AudioSettings } from "@/lib/audio/studio";

type Opt = "A" | "B" | "C" | "D";
type HelpType = "cards" | "fifty" | "audience" | "presenter";
type Limits = Record<HelpType, number>;
type Q = { id: number; statement: string; options: Record<Opt, string>; category: string; difficulty: string };
type View = {
  mode: string;
  phase: "awaiting_choice" | "locked" | "revealed" | "finished";
  levelIndex: number;
  levelNumber: number;
  totalLevels: number;
  prizes: number[];
  safetyQuestions: number[];
  safePrize: number;
  correctCount: number;
  lives: number | null;
  prize: number;
  finalPrize: number | null;
  currentPrize: number;
  question: Q | null;
  choice: Opt | null;
  locked: boolean;
  eliminated: Opt[];
  audience: Record<Opt, number> | null;
  card: { index: number; option: Opt; intensity: string } | null;
  hint: string | null;
  helpsUsed: Limits;
  helpLimits: Limits;
  helpsUsedThisQuestion: HelpType[];
  timerSeconds: number;
  questionStartedAt: number;
  reveal: { chosen: Opt | null; correct: Opt; isCorrect: boolean; justification: string; source: string } | null;
  outcome: string | null;
  endReason: string | null;
  specialPhrase: string;
};
type Config = {
  phrases: Record<string, string[]>;
  difficultyLabels: Record<string, string>;
  specialPhrase: string;
};

const OPTS: Opt[] = ["A", "B", "C", "D"];
const HELP_LABEL: Record<HelpType, string> = {
  cards: "Cartas",
  fifty: "Eliminar 2",
  audience: "Plateia",
  presenter: "Apresentador",
};
const HARD = ["dificil", "muito_dificil", "especialista"];

const brl = (v: number) => `R$ ${v.toLocaleString("pt-BR")}`;
const pick = (list: string[] | undefined): string => (list && list.length ? list[Math.floor(Math.random() * list.length)] : "");

export default function GameShow() {
  const router = useRouter();
  const studio = useMemo(() => getStudio(), []);
  const [cfg, setCfg] = useState<Config | null>(null);
  const [gameId, setGameId] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [g, setG] = useState<View | null>(null);
  const [helpResult, setHelpResult] = useState<string | null>(null);
  const [cardsOpen, setCardsOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const actRef = useRef<(body: Record<string, unknown>) => Promise<void>>(async () => {});
  const lastKey = useRef("");
  const [subtitle, setSubtitle] = useState<string | null>(null);
  const [speaking, setSpeaking] = useState(false);
  const [audio, setAudio] = useState<AudioSettings>(DEFAULT_AUDIO);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [entered, setEntered] = useState(false);
  const [confirmQuit, setConfirmQuit] = useState(false);
  const [timeLeft, setTimeLeft] = useState<number | null>(null);

  const applyView = useCallback((id: string, ver: number, view: View) => {
    setGameId(id);
    setVersion(ver);
    setG(view);
  }, []);

  /** Recarrega a partida ativa (recuperação após atualização da página ou conflito de versão). */
  const refresh = useCallback(async () => {
    const res = await fetch("/api/game", { cache: "no-store" });
    if (res.status === 401) {
      router.replace("/");
      return;
    }
    const data = await res.json();
    if (data.active) applyView(data.active.gameId, data.active.version, data.active.game);
    else router.replace("/");
  }, [applyView, router]);

  // Carregamento inicial: configuração pública, preferências de áudio e partida ativa.
  useEffect(() => {
    const s = loadAudioSettings();
    setAudio(s);
    studio.applySettings(s);
    studio.onSubtitle = (t) => setSubtitle(t);
    studio.onSpeakingChange = (v) => setSpeaking(v);
    if (studio.narrationSupported) {
      const loadVoices = () => setVoices(studio.voices());
      loadVoices();
      window.speechSynthesis.onvoiceschanged = loadVoices;
    }
    (async () => {
      try {
        const [c] = await Promise.all([fetch("/api/config").then((r) => r.json()), refresh()]);
        setCfg(c as Config);
      } catch {
        setError("Não foi possível carregar o programa. Verifique sua conexão e tente novamente.");
      }
    })();
    return () => {
      studio.onSubtitle = null;
      studio.onSpeakingChange = null;
      studio.stopMusic(0.3);
      studio.cancelSpeech();
    };
  }, [refresh, studio]);

  /** Envia uma ação ao servidor. Cliques repetidos são bloqueados por busyRef (síncrono). */
  const act = useCallback(
    async (body: Record<string, unknown>) => {
      if (!gameId || busyRef.current) return;
      busyRef.current = true;
      setBusy(true);
      setError(null);
      try {
        const res = await fetch(`/api/game/${gameId}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...body, version }),
        });
        const data = await res.json();
        if (res.status === 409) {
          setError(data.error ?? "Estado desatualizado.");
          await refresh();
          return;
        }
        if (!res.ok) {
          setError(data.error ?? "Não foi possível concluir a ação.");
          return;
        }
        applyView(gameId, data.version, data.game);
        if (body.action === "help") {
          const r = data.result as Record<string, unknown> | null;
          if (body.type === "cards" && r) {
            setCardsOpen(false);
            setHelpResult(`Sua carta indica a alternativa ${String(r.option)} (apoio ${String(r.intensity)}).`);
            studio.say(`Sua carta aponta para a letra ${String(r.option)}.`);
          } else if (body.type === "fifty") {
            setHelpResult("Duas alternativas erradas foram eliminadas.");
            studio.say("Eliminei duas alternativas erradas para você.");
          } else if (body.type === "audience") {
            setHelpResult("Resultado simulado da votação (não é uma pesquisa real).");
            studio.say("Aqui está a opinião simulada da plateia.");
          } else if (body.type === "presenter" && r) {
            setHelpResult(String(r.hint));
            studio.say(String(r.hint));
          }
          studio.play("help");
        } else if (body.action === "select") {
          studio.play("select");
        }
      } catch {
        setError("Conexão indisponível. Sua partida está salva; tente novamente em instantes.");
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    },
    [applyView, gameId, refresh, studio, version],
  );
  actRef.current = act;

  // Narração e efeitos por transição de estado (uma vez por mudança).
  useEffect(() => {
    if (!g || !cfg) return;
    const key = `${g.phase}:${g.levelIndex}:${g.outcome ?? ""}`;
    if (lastKey.current === key) return;
    lastKey.current = key;
    studio.setIntensity(g.levelIndex);
    if (g.phase === "awaiting_choice") {
      setHelpResult(null);
      studio.play("open");
      const value = g.prizes[g.levelIndex] ?? 0;
      studio.say(`Pergunta ${g.levelNumber}. Ela vale ${brl(value)}.`);
      if (HARD.includes(g.question?.difficulty ?? "")) studio.say(pick(cfg.phrases.hard));
      if (g.levelNumber === g.totalLevels && value >= 1000000) studio.say(pick(cfg.phrases.value));
    } else if (g.phase === "locked") {
      studio.play("lock");
      studio.say(pick(cfg.phrases.locked), true);
    } else if (g.phase === "revealed" || g.phase === "finished") {
      if (g.reveal?.isCorrect) {
        studio.play("correct");
        studio.say(pick(cfg.phrases.correct), true);
        studio.say(pick(cfg.phrases.encourage));
      } else if (g.reveal) {
        studio.play("wrong");
        studio.say(pick(cfg.phrases.wrong), true);
      }
      if (g.phase === "finished") {
        if (g.outcome === "victory") {
          studio.play("victory");
          studio.say(pick(cfg.phrases.top), true);
        } else if (g.outcome === "defeat") {
          studio.play("defeat");
        } else if (g.outcome === "walkaway") {
          studio.play("prize");
          studio.say(pick(cfg.phrases.walkaway));
        }
        studio.stopMusic(2.5);
      }
    }
  }, [g, cfg, studio]);

  // Fase travada: suspense e revelação automática (também recupera partidas após atualização).
  useEffect(() => {
    if (!g || g.phase !== "locked" || !gameId) return;
    studio.play("suspense");
    const t = setTimeout(() => {
      void actRef.current({ action: "reveal" });
    }, 3200);
    return () => clearTimeout(t);
  }, [g?.phase, g?.levelIndex, gameId, studio, g]);

  // Cronômetro por pergunta (quando habilitado). O servidor valida o prazo ao confirmar.
  useEffect(() => {
    if (!g || g.phase !== "awaiting_choice" || !g.timerSeconds) {
      setTimeLeft(null);
      return;
    }
    const end = g.questionStartedAt + g.timerSeconds * 1000;
    let prev = -1;
    const tick = () => {
      const left = Math.max(0, Math.ceil((end - Date.now()) / 1000));
      setTimeLeft(left);
      if (left !== prev && left > 0 && left <= 5) studio.play("tick");
      prev = left;
      if (left <= 0) void actRef.current({ action: "timeout" });
    };
    tick();
    const id = setInterval(tick, 500);
    return () => clearInterval(id);
  }, [g?.phase, g?.levelIndex, g?.questionStartedAt, g?.timerSeconds, studio, g]);

  const enter = () => {
    studio.unlock();
    setEntered(true);
    if (audio.musicOn && g) studio.startMusic(g.levelIndex);
    studio.say(cfg ? pick(cfg.phrases.welcome) : "Boa noite e bem-vindo ao palco!", true);
  };

  const updateAudio = (patch: Partial<AudioSettings>) => {
    const next = { ...audio, ...patch };
    setAudio(next);
    saveAudioSettings(next);
    studio.applySettings(next);
    if (patch.musicOn === true && entered && g) studio.startMusic(g.levelIndex);
    if (patch.musicOn === false) studio.stopMusic(0.5);
  };

  if (error && !g) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 p-6 text-center text-slate-100">
        <div className="max-w-md space-y-4">
          <p>{error}</p>
          <button onClick={() => router.replace("/")} className="rounded-lg bg-amber-400 px-4 py-2 font-semibold text-slate-900">Voltar ao início</button>
        </div>
      </div>
    );
  }
  if (!g || !cfg) {
    return <div className="flex min-h-screen items-center justify-center bg-slate-950 text-amber-300">Preparando o palco…</div>;
  }

  const q = g.question;
  const awaiting = g.phase === "awaiting_choice";
  const remaining = (t: HelpType) => g.helpLimits[t] - g.helpsUsed[t];
  const helpDisabled = (t: HelpType) => !awaiting || busy || remaining(t) <= 0 || g.helpsUsedThisQuestion.includes(t);
  const isFinished = g.phase === "finished";
  const finalValue = g.finalPrize ?? 0;
  const ladder = [...g.prizes.map((p, i) => ({ p, i }))].reverse();

  return (
    <div className="relative min-h-screen overflow-hidden bg-slate-950 text-slate-100">
      {/* Iluminação de palco */}
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(251,191,36,0.18),transparent_60%),radial-gradient(ellipse_at_bottom,rgba(56,189,248,0.12),transparent_55%)]" />

      {!entered && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/95 p-6">
          <div className="max-w-sm text-center">
            <p className="text-sm uppercase tracking-[0.3em] text-amber-300">Palco do Saber</p>
            <h1 className="mt-3 text-3xl font-black">Entre no estúdio</h1>
            <p className="mt-3 text-sm text-slate-300">Toque para ativar a trilha sonora e a narração. Você pode continuar sem som.</p>
            <div className="mt-6 flex flex-col gap-3">
              <button onClick={enter} className="rounded-xl bg-amber-400 px-6 py-3 font-bold text-slate-900 shadow-lg shadow-amber-500/30 hover:bg-amber-300">Entrar no palco</button>
              <button onClick={() => { setAudio({ ...audio, musicOn: false, narrationOn: false }); setEntered(true); }} className="rounded-xl border border-slate-600 px-6 py-2 text-slate-300 hover:bg-slate-800">Jogar em silêncio</button>
            </div>
          </div>
        </div>
      )}

      <header className="relative z-10 flex flex-wrap items-center justify-between gap-3 border-b border-amber-500/20 px-4 py-3">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-amber-300">Palco do Saber</p>
          <p className="text-sm text-slate-400">Modo: {modeName(g.mode)} · Pergunta {g.levelNumber}{g.totalLevels ? ` de ${g.totalLevels}` : ""}</p>
        </div>
        <div className="flex items-center gap-2">
          {g.lives !== null && <span className="rounded-full bg-rose-500/20 px-3 py-1 text-sm">❤ {g.lives} vidas</span>}
          <button onClick={() => setSettingsOpen(true)} className="rounded-lg border border-slate-600 px-3 py-1 text-sm hover:bg-slate-800">Som e narração</button>
          <button onClick={() => setConfirmQuit(true)} disabled={!awaiting || busy} className="rounded-lg border border-rose-500/50 px-3 py-1 text-sm text-rose-300 hover:bg-rose-500/10 disabled:opacity-40">Desistir</button>
        </div>
      </header>

      <main className="relative z-10 mx-auto grid max-w-6xl gap-4 p-4 lg:grid-cols-[260px_1fr_220px]">
        {/* Apresentador */}
        <aside className="order-2 flex flex-col gap-3 lg:order-1">
          <div className="rounded-2xl border border-amber-500/30 bg-gradient-to-b from-slate-800 to-slate-900 p-4 text-center shadow-xl">
            <div className={`mx-auto flex h-24 w-24 items-center justify-center rounded-full bg-gradient-to-br from-amber-300 to-orange-500 text-4xl shadow-lg ${speaking ? "animate-pulse ring-4 ring-amber-300/60" : ""}`}>🎤</div>
            <p className="mt-2 font-bold text-amber-200">Apresentador</p>
            <p className="text-xs text-slate-400">{speaking ? "falando…" : "no ar"}</p>
            {audio.subtitlesOn && subtitle && (
              <p aria-live="polite" className="mt-3 rounded-lg bg-slate-950/70 p-3 text-left text-sm leading-relaxed text-slate-100">{subtitle}</p>
            )}
          </div>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <button onClick={() => q && studio.say(`${q.statement} A: ${q.options.A}. B: ${q.options.B}. C: ${q.options.C}. D: ${q.options.D}.`, true)} className="rounded-lg border border-slate-600 px-2 py-2 hover:bg-slate-800">🔁 Repetir pergunta</button>
            <button onClick={() => studio.say(cfg.specialPhrase || g.specialPhrase, true)} className="rounded-lg border border-slate-600 px-2 py-2 hover:bg-slate-800">⭐ Fala especial</button>
            <button onClick={() => studio.cancelSpeech()} className="col-span-2 rounded-lg border border-slate-600 px-2 py-2 hover:bg-slate-800">⏹ Silenciar apresentador</button>
          </div>
          {g.timerSeconds > 0 && awaiting && (
            <div className={`rounded-xl p-3 text-center font-mono text-3xl font-black ${timeLeft !== null && timeLeft <= 5 ? "bg-rose-600/30 text-rose-200" : "bg-slate-800 text-amber-200"}`}>
              {timeLeft ?? g.timerSeconds}s
            </div>
          )}
        </aside>

        {/* Palco: pergunta e alternativas */}
        <section className="order-1 flex flex-col gap-4 lg:order-2">
          <div className="rounded-2xl border border-sky-400/30 bg-gradient-to-b from-slate-900 to-slate-950 p-5 shadow-2xl shadow-sky-900/30">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-xs uppercase tracking-widest text-sky-300">
              <span>{q?.category ?? ""}</span>
              <span>{q ? cfg.difficultyLabels[q.difficulty] ?? q.difficulty : ""}</span>
            </div>
            <p key={`q-${g.levelIndex}`} className="animate-[fadeIn_0.6s_ease] text-xl font-bold leading-snug md:text-2xl">
              {q?.statement ?? "Preparando a próxima pergunta…"}
            </p>
            <div className="mt-5 grid gap-3 md:grid-cols-2">
              {OPTS.map((o) => {
                const isEliminated = g.eliminated.includes(o);
                const isChoice = g.choice === o;
                const isCorrect = g.reveal?.correct === o;
                const isWrongChoice = !!g.reveal && isChoice && !g.reveal.isCorrect;
                let cls = "border-slate-600 bg-slate-800/70 hover:border-amber-300 hover:bg-slate-700";
                if (isChoice && !g.reveal) cls = "border-amber-300 bg-amber-400/20 ring-2 ring-amber-300/60";
                if (g.reveal && isCorrect) cls = "border-emerald-300 bg-emerald-500/30 ring-2 ring-emerald-300 animate-pulse";
                if (isWrongChoice) cls = "border-rose-400 bg-rose-600/30";
                if (isEliminated) cls = "border-slate-800 bg-slate-900 opacity-30 line-through";
                return (
                  <button
                    key={o}
                    disabled={!awaiting || busy || isEliminated || !q}
                    onClick={() => void act({ action: "select", option: o })}
                    className={`flex items-center gap-3 rounded-xl border-2 px-4 py-3 text-left text-base transition-all duration-200 disabled:cursor-not-allowed ${cls}`}
                  >
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber-400 font-black text-slate-900">{o}</span>
                    <span>{q?.options[o] ?? ""}</span>
                    {g.audience && <span className="ml-auto text-sm text-sky-200">{g.audience[o]}%</span>}
                  </button>
                );
              })}
            </div>

            {g.audience && (
              <p className="mt-3 rounded-lg bg-sky-950/60 p-2 text-xs text-sky-200">Votação SIMULADA da plateia (não é pesquisa real).</p>
            )}
            {g.card && <p className="mt-3 rounded-lg bg-amber-950/50 p-2 text-sm text-amber-200">Cartas: apoio {g.card.intensity} para a letra {g.card.option}.</p>}
            {g.hint && <p className="mt-3 rounded-lg bg-indigo-950/60 p-2 text-sm text-indigo-200">💡 {g.hint}</p>}
            {helpResult && !g.hint && !g.card && <p className="mt-3 rounded-lg bg-slate-800 p-2 text-sm text-slate-200">{helpResult}</p>}

            {/* Ações da fase */}
            <div className="mt-5 flex flex-wrap gap-3">
              {awaiting && (
                <button
                  onClick={() => void act({ action: "confirm" })}
                  disabled={!g.choice || busy}
                  className="rounded-xl bg-amber-400 px-6 py-3 font-black text-slate-900 shadow-lg shadow-amber-500/30 hover:bg-amber-300 disabled:opacity-40"
                >
                  Confirmar resposta {g.choice ? `(${g.choice})` : ""}
                </button>
              )}
              {g.phase === "locked" && <p className="animate-pulse py-3 text-lg font-bold text-amber-200">Vamos ver se você acertou…</p>}
              {g.phase === "revealed" && !isFinished && (
                <button onClick={() => void act({ action: "advance" })} disabled={busy} className="rounded-xl bg-emerald-500 px-6 py-3 font-black text-slate-900 hover:bg-emerald-400 disabled:opacity-40">
                  Próxima pergunta →
                </button>
              )}
            </div>

            {g.reveal && (
              <div className="mt-5 rounded-xl border border-slate-700 bg-slate-950/70 p-4 text-sm leading-relaxed">
                <p className="font-bold text-amber-200">{g.reveal.isCorrect ? "Resposta certa!" : g.outcome === "timeout" ? "Tempo esgotado." : "Resposta errada."} A correta é a letra {g.reveal.correct}.</p>
                <p className="mt-2 text-slate-300">{g.reveal.justification}</p>
                <p className="mt-2 text-xs text-slate-500">Fonte: {g.reveal.source}</p>
              </div>
            )}
          </div>

          {/* Ajudas */}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {(["cards", "fifty", "audience", "presenter"] as HelpType[]).map((t) => (
              <button
                key={t}
                disabled={helpDisabled(t)}
                onClick={() => (t === "cards" ? setCardsOpen(true) : void act({ action: "help", type: t }))}
                className="rounded-xl border border-indigo-400/40 bg-indigo-950/60 px-3 py-3 text-sm font-semibold hover:bg-indigo-900/70 disabled:opacity-35"
              >
                {HELP_LABEL[t]}
                <span className="block text-xs font-normal text-indigo-200">restam {Math.max(0, remaining(t))}</span>
              </button>
            ))}
          </div>
          {g.mode === "training" && <p className="text-center text-xs text-slate-400">Modo treinamento: erros não encerram a partida.</p>}
          {error && <p role="alert" className="rounded-lg bg-rose-900/60 p-3 text-sm text-rose-100">{error}</p>}
        </section>

        {/* Escada de premiação */}
        <aside className="order-3 rounded-2xl border border-amber-500/30 bg-slate-900/80 p-3">
          <p className="mb-2 text-center text-xs uppercase tracking-widest text-amber-300">Premiação</p>
          <ol className="space-y-1 text-sm">
            {ladder.map(({ p, i }) => {
              const number = i + 1;
              const isCurrent = i === g.levelIndex && !isFinished;
              const passed = i < g.levelIndex || (isFinished && i < g.correctCount);
              const safe = g.safetyQuestions.includes(number);
              return (
                <li key={number} className={`flex items-center justify-between rounded px-2 py-1 ${isCurrent ? "bg-amber-400 font-black text-slate-900" : passed ? "text-emerald-300" : "text-slate-300"}`}>
                  <span>{number}</span>
                  <span>{safe ? "🛡 " : ""}{p.toLocaleString("pt-BR")}</span>
                </li>
              );
            })}
          </ol>
          <p className="mt-3 text-center text-xs text-slate-400">Seguro atual: <span className="text-emerald-300">{brl(g.safePrize)}</span></p>
          <p className="mt-1 text-center text-[11px] text-slate-500">Valores fictícios: pontuação virtual, sem pagamento em dinheiro.</p>
        </aside>
      </main>

      {/* Cartas */}
      {cardsOpen && (
        <Modal title="Escolha uma carta" onClose={() => setCardsOpen(false)}>
          <p className="mb-4 text-sm text-slate-300">A carta revela uma indicação de apoio. A intensidade pode variar.</p>
          <div className="grid grid-cols-4 gap-3">
            {[0, 1, 2, 3].map((i) => (
              <button key={i} disabled={busy} onClick={() => void act({ action: "help", type: "cards", index: i })} className="flex aspect-[3/4] items-center justify-center rounded-xl border-2 border-amber-300 bg-gradient-to-br from-indigo-700 to-slate-800 text-3xl font-black text-amber-200 shadow-lg hover:-translate-y-1 transition-transform disabled:opacity-50">
                ?
              </button>
            ))}
          </div>
        </Modal>
      )}

      {/* Confirmação de desistência */}
      {confirmQuit && (
        <Modal title="Desistir da partida?" onClose={() => setConfirmQuit(false)}>
          <p className="text-sm text-slate-300">Você levará a premiação acumulada até agora: <strong className="text-amber-300">{brl(g.prizes[g.correctCount - 1] ?? 0)}</strong>.</p>
          <div className="mt-5 flex justify-end gap-3">
            <button onClick={() => setConfirmQuit(false)} className="rounded-lg border border-slate-600 px-4 py-2">Continuar jogando</button>
            <button onClick={() => { setConfirmQuit(false); void act({ action: "walkaway" }); }} className="rounded-lg bg-rose-600 px-4 py-2 font-semibold">Sim, desistir</button>
          </div>
        </Modal>
      )}

      {/* Configurações de áudio */}
      {settingsOpen && (
        <Modal title="Som e narração" onClose={() => setSettingsOpen(false)}>
          <div className="space-y-4 text-sm">
            <Toggle label="Música de fundo" checked={audio.musicOn} onChange={(v) => updateAudio({ musicOn: v })} />
            <Toggle label="Narração do apresentador" checked={audio.narrationOn} onChange={(v) => updateAudio({ narrationOn: v })} />
            <Toggle label="Legendas" checked={audio.subtitlesOn} onChange={(v) => updateAudio({ subtitlesOn: v })} />
            <Slider label="Volume da música" value={audio.musicVolume} onChange={(v) => updateAudio({ musicVolume: v })} />
            <Slider label="Volume dos efeitos" value={audio.sfxVolume} onChange={(v) => updateAudio({ sfxVolume: v })} />
            <Slider label="Volume da voz" value={audio.voiceVolume} onChange={(v) => updateAudio({ voiceVolume: v })} />
            <Slider label={`Velocidade da fala (${audio.rate.toFixed(1)}x)`} value={audio.rate} min={0.7} max={1.3} step={0.1} onChange={(v) => updateAudio({ rate: v })} />
            <label className="block">
              <span className="mb-1 block text-slate-300">Voz disponível</span>
              <select value={audio.voiceURI} onChange={(e) => updateAudio({ voiceURI: e.target.value })} className="w-full rounded-lg bg-slate-800 p-2">
                <option value="">Padrão do sistema (pt-BR)</option>
                {voices.map((v) => <option key={v.voiceURI} value={v.voiceURI}>{v.name} ({v.lang})</option>)}
              </select>
              {!studio.narrationSupported && <span className="text-xs text-amber-300">Este navegador não oferece narração; as legendas continuam disponíveis.</span>}
              {studio.narrationSupported && voices.length === 0 && <span className="text-xs text-slate-400">Nenhuma voz pt-BR instalada: o navegador usará a voz padrão ou apenas legendas.</span>}
            </label>
          </div>
        </Modal>
      )}

      {/* Resultado final */}
      {isFinished && (
        <Modal title={resultTitle(g.outcome)} onClose={() => undefined}>
          <p className="text-4xl font-black text-amber-300">{brl(finalValue)}</p>
          <p className="mt-1 text-xs text-slate-400">pontuação virtual</p>
          <p className="mt-4 text-sm text-slate-300">{g.endReason}</p>
          <p className="mt-2 text-sm text-slate-400">Acertos: {g.correctCount} de {g.levelNumber - (g.reveal && !g.reveal.isCorrect ? 1 : 0)} respondidas.</p>
          <div className="mt-6 flex flex-wrap justify-end gap-3">
            <button onClick={() => router.push("/perfil")} className="rounded-lg border border-slate-600 px-4 py-2">Estatísticas</button>
            <button onClick={() => router.push("/")} className="rounded-lg bg-amber-400 px-5 py-2 font-bold text-slate-900">Jogar novamente</button>
          </div>
        </Modal>
      )}
      <style>{`@keyframes fadeIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }`}</style>
    </div>
  );
}

function modeName(mode: string): string {
  const names: Record<string, string> = {
    classic: "Clássico",
    infinite: "Infinito",
    quick: "Rápido",
    survival: "Sobrevivência",
    categories: "Categorias",
    training: "Treinamento",
    daily: "Desafio diário",
  };
  return names[mode] ?? mode;
}

function resultTitle(outcome: string | null): string {
  if (outcome === "victory") return "🏆 Parabéns, você chegou ao topo!";
  if (outcome === "walkaway") return "Você levou sua premiação";
  return "Fim de jogo";
}

function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-lg rounded-2xl border border-amber-400/40 bg-slate-900 p-6 shadow-2xl">
        <div className="mb-4 flex items-start justify-between gap-4">
          <h2 className="text-xl font-black text-amber-200">{title}</h2>
          <button onClick={onClose} aria-label="Fechar" className="text-slate-400 hover:text-white">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center justify-between">
      <span>{label}</span>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="h-5 w-5 accent-amber-400" />
    </label>
  );
}

function Slider({ label, value, onChange, min = 0, max = 1, step = 0.05 }: { label: string; value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number }) {
  return (
    <label className="block">
      <span className="mb-1 block text-slate-300">{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="w-full accent-amber-400" />
    </label>
  );
}
