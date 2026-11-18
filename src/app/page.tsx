"use client";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type User = { id: number; username: string; role: string };
type Mode = { key: string; name: string; desc: string };
type Stats = {
  totals: { matches: number; victories: number; defeats: number; walkaways: number; accumulatedPrize: number; bestPrize: number };
  answers: { total: number; correct: number; accuracy: number; avgResponseMs: number };
  bestCategories: { category: string; rate: number; total: number }[];
  hardestCategories: { category: string; rate: number; total: number }[];
  evolution: { prize: number; correct: number; outcome: string; mode: string }[];
};
type Ranking = { position: number; username: string; best: number; matches: number }[];

const MODES: Mode[] = [
  { key: "classic", name: "Clássico", desc: "17 perguntas com dificuldade crescente, pontos de segurança e ajudas." },
  { key: "infinite", name: "Infinito", desc: "Continue respondendo enquanto acertar. Sem limite de perguntas." },
  { key: "quick", name: "Rápido", desc: "Partida curta com número limitado de perguntas." },
  { key: "survival", name: "Sobrevivência", desc: "Erros custam vidas. Acumule o máximo de acertos." },
  { key: "categories", name: "Categorias", desc: "Escolha os temas que quiser e responda só sobre eles." },
  { key: "training", name: "Treinamento", desc: "Errar não encerra a partida. Explicações a cada resposta." },
  { key: "daily", name: "Desafio diário", desc: "Mesmas 5 perguntas para todos hoje. Uma tentativa por dia." },
];

const brl = (v: number) => `R$ ${v.toLocaleString("pt-BR")}`;

export default function HomePage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [form, setForm] = useState({ username: "", password: "" });
  const [authError, setAuthError] = useState<string | null>(null);
  const [activeGame, setActiveGame] = useState<boolean>(false);
  const [daily, setDaily] = useState<{ played: boolean } | null>(null);
  const [categories, setCategories] = useState<{ name: string; count: number }[]>([]);
  const [chosen, setChosen] = useState<string[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [ranking, setRanking] = useState<Ranking>([]);
  const [startError, setStartError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [pendingReplace, setPendingReplace] = useState<string | null>(null);

  const loadAll = useCallback(async () => {
    const me = await fetch("/api/auth/me", { cache: "no-store" }).then((r) => r.json());
    setUser(me.user ?? null);
    const cfg = await fetch("/api/config").then((r) => r.json());
    setCategories(cfg.categories ?? []);
    if (me.user) {
      const [game, st] = await Promise.all([
        fetch("/api/game", { cache: "no-store" }).then((r) => r.json()),
        fetch("/api/stats", { cache: "no-store" }).then((r) => r.json()),
      ]);
      setActiveGame(Boolean(game.active));
      setDaily(game.daily);
      setStats(st.stats);
      setRanking(st.ranking ?? []);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  useEffect(() => {
    if (window.location.hash === "#estatisticas") {
      document.getElementById("estatisticas")?.scrollIntoView({ behavior: "smooth" });
    }
  }, [stats]);

  const submitAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    const res = await fetch(`/api/auth/${authMode}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    const data = await res.json();
    if (!res.ok) {
      setAuthError(data.error ?? "Não foi possível entrar.");
      return;
    }
    setForm({ username: "", password: "" });
    setLoading(true);
    await loadAll();
  };

  const logout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    setUser(null);
    setStats(null);
    setActiveGame(false);
  };

  const start = async (mode: string, replace = false) => {
    if (starting) return;
    setStarting(true);
    setStartError(null);
    const res = await fetch("/api/game", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode, categories: mode === "categories" ? chosen : undefined, replace }),
    });
    const data = await res.json();
    setStarting(false);
    if (res.status === 409 && !replace && data.error?.includes("andamento")) {
      setPendingReplace(mode);
      setStartError(data.error);
      return;
    }
    if (!res.ok) {
      setStartError(data.error ?? "Não foi possível iniciar a partida.");
      return;
    }
    router.push("/jogar");
  };

  if (loading) {
    return <div className="flex min-h-screen items-center justify-center text-amber-300">Carregando…</div>;
  }

  return (
    <div className="relative min-h-screen overflow-hidden">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(251,191,36,0.15),transparent_55%)]" />
      <header className="relative z-10 flex flex-wrap items-center justify-between gap-3 border-b border-amber-500/20 px-6 py-4">
        <div>
          <p className="text-xs uppercase tracking-[0.35em] text-amber-300">Game show de conhecimentos</p>
          <h1 className="text-2xl font-black">Palco do Saber</h1>
        </div>
        {user && (
          <div className="flex items-center gap-3 text-sm">
            <span className="text-slate-300">Olá, <strong className="text-amber-200">{user.username}</strong></span>
            {user.role === "admin" && <a href="/admin" className="rounded-lg border border-sky-400/50 px-3 py-1 text-sky-200 hover:bg-sky-500/10">Painel admin</a>}
            <button onClick={logout} className="rounded-lg border border-slate-600 px-3 py-1 hover:bg-slate-800">Sair</button>
          </div>
        )}
      </header>

      <main className="relative z-10 mx-auto max-w-6xl space-y-10 p-6">
        {!user && (
          <section className="mx-auto max-w-md rounded-2xl border border-amber-500/30 bg-slate-900/80 p-6 shadow-2xl">
            <div className="mb-4 flex gap-2 rounded-lg bg-slate-800 p-1 text-sm">
              {(["login", "register"] as const).map((m) => (
                <button key={m} onClick={() => setAuthMode(m)} className={`flex-1 rounded-md py-2 font-semibold ${authMode === m ? "bg-amber-400 text-slate-900" : "text-slate-300"}`}>
                  {m === "login" ? "Entrar" : "Criar conta"}
                </button>
              ))}
            </div>
            <form onSubmit={submitAuth} className="space-y-3">
              <input required minLength={3} placeholder="Usuário" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} className="w-full rounded-lg bg-slate-800 p-3" autoComplete="username" />
              <input required minLength={6} type="password" placeholder="Senha (mín. 6 caracteres)" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} className="w-full rounded-lg bg-slate-800 p-3" autoComplete={authMode === "login" ? "current-password" : "new-password"} />
              {authError && <p role="alert" className="text-sm text-rose-300">{authError}</p>}
              <button className="w-full rounded-lg bg-amber-400 py-3 font-black text-slate-900 hover:bg-amber-300">{authMode === "login" ? "Entrar no palco" : "Criar conta e entrar"}</button>
            </form>
          </section>
        )}

        {user && (
          <>
            <section className="rounded-2xl border border-amber-500/30 bg-gradient-to-br from-slate-900 to-slate-950 p-6 shadow-2xl">
              <h2 className="text-lg font-bold text-amber-200">Escolha seu modo de jogo</h2>
              {activeGame && (
                <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-emerald-400/40 bg-emerald-900/30 p-4">
                  <p className="flex-1">Você tem uma partida em andamento.</p>
                  <button onClick={() => router.push("/jogar")} className="rounded-lg bg-emerald-400 px-4 py-2 font-bold text-slate-900">Continuar partida</button>
                </div>
              )}
              {startError && (
                <div role="alert" className="mt-4 rounded-xl bg-rose-900/50 p-4 text-sm">
                  {startError}
                  {pendingReplace && (
                    <button onClick={() => void start(pendingReplace, true)} className="ml-3 rounded bg-rose-500 px-3 py-1 font-semibold">Abandonar e começar nova</button>
                  )}
                </div>
              )}
              <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {MODES.map((m) => {
                  const disabled = starting || (m.key === "daily" && daily?.played) || (m.key === "categories" && chosen.length === 0);
                  return (
                    <div key={m.key} className="flex flex-col rounded-xl border border-slate-700 bg-slate-800/60 p-4">
                      <h3 className="font-bold text-amber-100">{m.name}</h3>
                      <p className="mt-1 flex-1 text-sm text-slate-400">{m.desc}</p>
                      {m.key === "daily" && daily?.played && <p className="mt-2 text-xs text-emerald-300">Você já jogou hoje.</p>}
                      <button disabled={disabled} onClick={() => void start(m.key)} className="mt-3 rounded-lg bg-amber-400 py-2 font-bold text-slate-900 hover:bg-amber-300 disabled:opacity-40">
                        {m.key === "categories" ? "Jogar com as categorias escolhidas" : "Jogar"}
                      </button>
                    </div>
                  );
                })}
              </div>
              <details className="mt-6 rounded-xl border border-slate-700 p-4">
                <summary className="cursor-pointer font-semibold text-sky-200">Categorias para o modo Categorias ({chosen.length} selecionadas)</summary>
                <div className="mt-3 grid grid-cols-2 gap-2 text-sm md:grid-cols-4">
                  {categories.map((c) => (
                    <label key={c.name} className="flex items-center gap-2">
                      <input type="checkbox" className="accent-amber-400" checked={chosen.includes(c.name)} onChange={(e) => setChosen(e.target.checked ? [...chosen, c.name] : chosen.filter((x) => x !== c.name))} />
                      <span>{c.name} <span className="text-slate-500">({c.count})</span></span>
                    </label>
                  ))}
                </div>
              </details>
            </section>

            <section id="estatisticas" className="grid gap-6 lg:grid-cols-3">
              <div className="rounded-2xl border border-slate-700 bg-slate-900 p-6 lg:col-span-2">
                <h2 className="text-lg font-bold text-amber-200">Seu desempenho</h2>
                {stats && stats.totals.matches > 0 ? (
                  <>
                    <div className="mt-4 grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
                      <Stat label="Partidas" value={String(stats.totals.matches)} />
                      <Stat label="Vitórias" value={String(stats.totals.victories)} />
                      <Stat label="Derrotas" value={String(stats.totals.defeats)} />
                      <Stat label="Maior premiação" value={brl(stats.totals.bestPrize)} />
                      <Stat label="Premiação acumulada" value={brl(stats.totals.accumulatedPrize)} />
                      <Stat label="Acertos" value={`${stats.answers.accuracy}%`} />
                      <Stat label="Respondidas" value={String(stats.answers.total)} />
                      <Stat label="Tempo médio" value={`${(stats.answers.avgResponseMs / 1000).toFixed(1)} s`} />
                    </div>
                    <div className="mt-5 grid gap-4 md:grid-cols-2 text-sm">
                      <div>
                        <p className="font-semibold text-emerald-300">Melhores categorias</p>
                        {stats.bestCategories.map((c) => <p key={c.category}>{c.category}: {c.rate}% ({c.total})</p>)}
                      </div>
                      <div>
                        <p className="font-semibold text-rose-300">Maior dificuldade</p>
                        {stats.hardestCategories.map((c) => <p key={c.category}>{c.category}: {c.rate}% ({c.total})</p>)}
                      </div>
                    </div>
                    <div className="mt-5">
                      <p className="mb-2 text-sm font-semibold text-sky-200">Evolução (últimas partidas)</p>
                      <div className="flex h-24 items-end gap-1">
                        {stats.evolution.map((e, i) => {
                          const max = Math.max(...stats.evolution.map((x) => x.prize), 1);
                          return <div key={i} title={`${brl(e.prize)} · ${e.correct} acertos`} className={`w-3 rounded-t ${e.outcome === "victory" ? "bg-emerald-400" : "bg-amber-400"}`} style={{ height: `${Math.max(4, (e.prize / max) * 100)}%` }} />;
                        })}
                      </div>
                    </div>
                  </>
                ) : (
                  <p className="mt-3 text-sm text-slate-400">Jogue sua primeira partida para ver suas estatísticas aqui.</p>
                )}
              </div>
              <div className="rounded-2xl border border-slate-700 bg-slate-900 p-6">
                <h2 className="text-lg font-bold text-amber-200">Ranking</h2>
                <ol className="mt-3 space-y-2 text-sm">
                  {ranking.length === 0 && <li className="text-slate-400">Ainda não há partidas finalizadas.</li>}
                  {ranking.map((r) => (
                    <li key={r.position} className="flex justify-between"><span>{r.position}. {r.username}</span><span className="text-amber-300">{brl(r.best)}</span></li>
                  ))}
                </ol>
              </div>
            </section>
          </>
        )}

        <section id="regras" className="rounded-2xl border border-slate-700 bg-slate-900/70 p-6 text-sm leading-relaxed text-slate-300">
          <h2 className="text-lg font-bold text-amber-200">Regras</h2>
          <ul className="mt-3 list-disc space-y-2 pl-5">
            <li>Cada pergunta tem quatro alternativas (A, B, C e D) e somente uma correta.</li>
            <li>Escolha uma alternativa, troque se quiser e confirme. Após confirmar, a resposta fica travada.</li>
            <li>Errar encerra a partida com a premiação do último ponto de segurança alcançado.</li>
            <li>Você pode desistir antes de confirmar e levar a premiação acumulada.</li>
            <li>Ajudas são limitadas por partida: cartas, eliminar duas alternativas, plateia (simulada) e apresentador.</li>
            <li>Os valores são fictícios: pontuação virtual, sem qualquer pagamento em dinheiro.</li>
          </ul>
        </section>
        <footer className="pb-6 text-center text-xs text-slate-500">Palco do Saber é um projeto original. Não utiliza marcas, cenários, músicas ou vozes de programas de terceiros.</footer>
      </main>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-slate-800/70 p-3">
      <p className="text-xs text-slate-400">{label}</p>
      <p className="text-lg font-bold text-amber-100">{value}</p>
    </div>
  );
}
