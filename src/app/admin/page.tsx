"use client";
import { useCallback, useEffect, useState } from "react";

type Row = {
  id: number;
  statement: string;
  category: string;
  subcategory: string;
  difficulty: string;
  options: Record<"A" | "B" | "C" | "D", string>;
  correct: string;
  justification: string;
  hint: string;
  source: string;
  validationStatus: string;
  tags: string[];
  active: boolean;
  timesAsked: number;
};
type Form = Omit<Row, "id" | "validationStatus" | "timesAsked"> & { id?: number };

const DIFFS = ["muito_facil", "facil", "intermediaria", "dificil", "muito_dificil", "especialista"];
const emptyForm: Form = {
  statement: "", category: "", subcategory: "", difficulty: "facil",
  options: { A: "", B: "", C: "", D: "" }, correct: "A", justification: "", hint: "", source: "", tags: [], active: true,
};

type Tab = "perguntas" | "importar" | "config" | "ia";

export default function AdminPage() {
  const [me, setMe] = useState<{ username: string; role: string } | null | undefined>(undefined);
  const [tab, setTab] = useState<Tab>("perguntas");
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/auth/me").then((r) => r.json()).then((d) => setMe(d.user));
  }, []);

  if (me === undefined) return <div className="p-8 text-amber-300">Carregando…</div>;
  if (!me || me.role !== "admin") {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
        <p>Acesso restrito a administradores.</p>
        <a href="/" className="rounded-lg bg-amber-400 px-4 py-2 font-bold text-slate-900">Voltar ao início</a>
      </div>
    );
  }

  return (
    <div className="min-h-screen p-6">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-sky-300">Painel administrativo</p>
          <h1 className="text-2xl font-black">Palco do Saber — gestão</h1>
        </div>
        <a href="/" className="rounded-lg border border-slate-600 px-3 py-1 text-sm hover:bg-slate-800">Voltar ao jogo</a>
      </header>
      <nav className="mb-6 flex flex-wrap gap-2">
        {([["perguntas", "Perguntas"], ["importar", "Importar / Exportar / Duplicadas"], ["config", "Premiação e falas"], ["ia", "IA"]] as [Tab, string][]).map(([k, label]) => (
          <button key={k} onClick={() => { setTab(k); setMsg(null); }} className={`rounded-lg px-4 py-2 text-sm font-semibold ${tab === k ? "bg-sky-400 text-slate-900" : "border border-slate-600 text-slate-300"}`}>{label}</button>
        ))}
      </nav>
      {msg && <p role="status" className="mb-4 rounded-lg bg-slate-800 p-3 text-sm">{msg}</p>}
      {tab === "perguntas" && <QuestionsTab setMsg={setMsg} />}
      {tab === "importar" && <ImportTab setMsg={setMsg} />}
      {tab === "config" && <ConfigTab setMsg={setMsg} />}
      {tab === "ia" && <AiTab setMsg={setMsg} />}
    </div>
  );
}

type SetMsg = (m: string | null) => void;

function QuestionsTab({ setMsg }: { setMsg: SetMsg }) {
  const [items, setItems] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [active, setActive] = useState("");
  const [form, setForm] = useState<Form | null>(null);
  const [overview, setOverview] = useState<{ totals: { total: number; active: number; pending: number }; players: number; finishedGames: number } | null>(null);

  const load = useCallback(async () => {
    const params = new URLSearchParams({ page: String(page) });
    if (q) params.set("q", q);
    if (status) params.set("status", status);
    if (active) params.set("active", active);
    const data = await fetch(`/api/admin/questions?${params}`, { cache: "no-store" }).then((r) => r.json());
    setItems(data.items ?? []);
    setTotal(data.total ?? 0);
    const ov = await fetch("/api/admin/questions?view=overview", { cache: "no-store" }).then((r) => r.json());
    setOverview(ov);
  }, [page, q, status, active]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    if (!form) return;
    const payload = { ...form, tags: Array.isArray(form.tags) ? form.tags : String(form.tags).split(",") };
    const url = form.id ? `/api/admin/questions/${form.id}` : "/api/admin/questions";
    const res = await fetch(url, { method: form.id ? "PUT" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    const data = await res.json();
    if (!res.ok) {
      setMsg([data.error, ...(data.errors ?? [])].filter(Boolean).join(" • "));
      return;
    }
    setMsg(form.id ? "Pergunta atualizada e revalidada." : "Pergunta criada e publicada.");
    setForm(null);
    void load();
  };

  const approve = async (r: Row) => {
    const res = await fetch(`/api/admin/questions/${r.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...r, options: r.options, tags: r.tags, active: true, validationStatus: "revisao_humana" }),
    });
    const data = await res.json();
    setMsg(res.ok ? "Pergunta aprovada e ativada." : (data.error ?? "Falha ao aprovar."));
    void load();
  };

  const remove = async (r: Row) => {
    if (!confirm("Excluir ou desativar esta pergunta?")) return;
    const res = await fetch(`/api/admin/questions/${r.id}`, { method: "DELETE" });
    const data = await res.json();
    setMsg(res.ok ? (data.mode === "excluida" ? "Pergunta excluída." : "Pergunta já utilizada: foi desativada para preservar o histórico.") : (data.error ?? "Falha."));
    void load();
  };

  const field = (k: keyof Form, label: string, multiline = false) => (
    <label className="block text-sm">
      <span className="mb-1 block text-slate-300">{label}</span>
      {multiline ? (
        <textarea value={String(form?.[k] ?? "")} onChange={(e) => setForm({ ...(form as Form), [k]: e.target.value })} rows={2} className="w-full rounded-lg bg-slate-800 p-2" />
      ) : (
        <input value={String(form?.[k] ?? "")} list={k === "category" ? "cats" : undefined} onChange={(e) => setForm({ ...(form as Form), [k]: e.target.value })} className="w-full rounded-lg bg-slate-800 p-2" />
      )}
    </label>
  );

  return (
    <div className="space-y-6">
      {overview && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Card label="Perguntas" value={overview.totals.total} />
          <Card label="Ativas" value={overview.totals.active} />
          <Card label="Aguardando aprovação" value={overview.totals.pending} />
          <Card label="Partidas finalizadas" value={overview.finishedGames} />
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <input placeholder="Buscar no enunciado" value={q} onChange={(e) => { setPage(1); setQ(e.target.value); }} className="rounded-lg bg-slate-800 p-2 text-sm" />
        <select value={status} onChange={(e) => { setPage(1); setStatus(e.target.value); }} className="rounded-lg bg-slate-800 p-2 text-sm">
          <option value="">Todos os status</option>
          <option value="aguardando_aprovacao">Aguardando aprovação (IA)</option>
          <option value="revisao_humana">Revisadas</option>
          <option value="validacao_automatica">Validação automática</option>
        </select>
        <select value={active} onChange={(e) => { setPage(1); setActive(e.target.value); }} className="rounded-lg bg-slate-800 p-2 text-sm">
          <option value="">Ativas e inativas</option>
          <option value="1">Somente ativas</option>
          <option value="0">Somente inativas</option>
        </select>
        <button onClick={() => setForm({ ...emptyForm })} className="rounded-lg bg-sky-400 px-4 py-2 text-sm font-bold text-slate-900">+ Nova pergunta</button>
      </div>

      {form && (
        <div className="rounded-xl border border-sky-400/40 bg-slate-900 p-5">
          <h2 className="mb-4 font-bold text-sky-200">{form.id ? `Editar pergunta #${form.id}` : "Nova pergunta"}</h2>
          <datalist id="cats">{[...new Set(items.map((i) => i.category))].map((c) => <option key={c} value={c} />)}</datalist>
          <div className="grid gap-3 md:grid-cols-2">
            {field("statement", "Enunciado", true)}
            <div className="space-y-3">
              {field("category", "Categoria (digite uma nova para criá-la)")}
              {field("subcategory", "Subcategoria")}
              <label className="block text-sm"><span className="mb-1 block text-slate-300">Dificuldade</span>
                <select value={form.difficulty} onChange={(e) => setForm({ ...form, difficulty: e.target.value })} className="w-full rounded-lg bg-slate-800 p-2">{DIFFS.map((d) => <option key={d} value={d}>{d}</option>)}</select>
              </label>
            </div>
            {(["A", "B", "C", "D"] as const).map((o) => (
              <label key={o} className="block text-sm"><span className="mb-1 block text-slate-300">Alternativa {o}</span>
                <input value={form.options[o]} onChange={(e) => setForm({ ...form, options: { ...form.options, [o]: e.target.value } })} className="w-full rounded-lg bg-slate-800 p-2" />
              </label>
            ))}
            <label className="block text-sm"><span className="mb-1 block text-slate-300">Correta</span>
              <select value={form.correct} onChange={(e) => setForm({ ...form, correct: e.target.value })} className="w-full rounded-lg bg-slate-800 p-2">{["A", "B", "C", "D"].map((o) => <option key={o}>{o}</option>)}</select>
            </label>
            {field("justification", "Justificativa (obrigatória)", true)}
            {field("source", "Fonte de referência (obrigatória)")}
            {field("hint", "Dica do apresentador (opcional)")}
            <label className="block text-sm"><span className="mb-1 block text-slate-300">Tags (separadas por vírgula)</span>
              <input value={Array.isArray(form.tags) ? form.tags.join(", ") : String(form.tags)} onChange={(e) => setForm({ ...form, tags: e.target.value.split(",").map((t) => t.trim()).filter(Boolean) })} className="w-full rounded-lg bg-slate-800 p-2" />
            </label>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} className="accent-sky-400" /> Ativa no jogo</label>
          </div>
          <div className="mt-4 flex gap-3">
            <button onClick={save} className="rounded-lg bg-amber-400 px-5 py-2 font-bold text-slate-900">Salvar</button>
            <button onClick={() => setForm(null)} className="rounded-lg border border-slate-600 px-5 py-2">Cancelar</button>
          </div>
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-slate-700">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-800 text-slate-300"><tr><th className="p-2">#</th><th className="p-2">Enunciado</th><th className="p-2">Categoria</th><th className="p-2">Dificuldade</th><th className="p-2">Status</th><th className="p-2">Ações</th></tr></thead>
          <tbody>
            {items.map((r) => (
              <tr key={r.id} className="border-t border-slate-800 align-top">
                <td className="p-2">{r.id}</td>
                <td className="max-w-md p-2">{r.statement}{!r.active && <span className="ml-2 text-rose-300">[inativa]</span>}</td>
                <td className="p-2">{r.category}</td>
                <td className="p-2">{r.difficulty}</td>
                <td className="p-2">{r.validationStatus}</td>
                <td className="space-x-2 whitespace-nowrap p-2">
                  <button onClick={() => setForm({ ...r, tags: r.tags })} className="text-sky-300 hover:underline">Editar</button>
                  {r.validationStatus === "aguardando_aprovacao" && <button onClick={() => approve(r)} className="text-emerald-300 hover:underline">Aprovar</button>}
                  <button onClick={() => remove(r)} className="text-rose-300 hover:underline">Excluir</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-between text-sm">
        <span>{total} registro(s)</span>
        <div className="space-x-2">
          <button disabled={page <= 1} onClick={() => setPage(page - 1)} className="rounded border border-slate-600 px-3 py-1 disabled:opacity-40">Anterior</button>
          <span>Página {page}</span>
          <button disabled={page * 25 >= total} onClick={() => setPage(page + 1)} className="rounded border border-slate-600 px-3 py-1 disabled:opacity-40">Próxima</button>
        </div>
      </div>
    </div>
  );
}

function ImportTab({ setMsg }: { setMsg: SetMsg }) {
  const [text, setText] = useState("");
  const [report, setReport] = useState<unknown>(null);
  const [groups, setGroups] = useState<Row[][]>([]);

  const run = async (action: "import" | "validate") => {
    const res = await fetch("/api/admin/questions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, text }) });
    const data = await res.json();
    if (!res.ok) return setMsg(data.error ?? "Falha.");
    setReport(data);
    setMsg(action === "import" ? `Importação concluída: ${data.report?.inserted ?? 0} inserida(s).` : "Validação concluída (nada foi gravado).");
  };

  const loadDuplicates = async () => {
    const data = await fetch("/api/admin/questions?view=duplicates", { cache: "no-store" }).then((r) => r.json());
    setGroups(data.groups ?? []);
    setMsg(`${(data.groups ?? []).length} grupo(s) de possíveis duplicatas.`);
  };

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-slate-700 p-5">
        <h2 className="font-bold text-sky-200">Importar perguntas</h2>
        <p className="mt-1 text-xs text-slate-400">Formato: categoria|dificuldade|enunciado|A|B|C|D|correta|justificativa|fonte|tags — uma pergunta por linha. Linhas com # são ignoradas.</p>
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={8} className="mt-3 w-full rounded-lg bg-slate-800 p-3 font-mono text-xs" />
        <div className="mt-3 flex gap-3">
          <button onClick={() => run("validate")} className="rounded-lg border border-slate-600 px-4 py-2">Validar sem gravar</button>
          <button onClick={() => run("import")} className="rounded-lg bg-amber-400 px-4 py-2 font-bold text-slate-900">Importar</button>
        </div>
        {report !== null && <pre className="mt-4 max-h-80 overflow-auto rounded-lg bg-slate-950 p-3 text-xs">{JSON.stringify(report, null, 2)}</pre>}
      </div>
      <div className="rounded-xl border border-slate-700 p-5">
        <h2 className="font-bold text-sky-200">Exportar</h2>
        <div className="mt-3 flex flex-wrap gap-3 text-sm">
          <a className="rounded-lg border border-slate-600 px-4 py-2" href="/api/admin/questions?view=export&format=json">Exportar JSON (completo)</a>
          <a className="rounded-lg border border-slate-600 px-4 py-2" href="/api/admin/questions?view=export&format=txt">Exportar TXT (formato de importação)</a>
        </div>
      </div>
      <div className="rounded-xl border border-slate-700 p-5">
        <h2 className="font-bold text-sky-200">Possíveis duplicadas</h2>
        <button onClick={loadDuplicates} className="mt-3 rounded-lg border border-slate-600 px-4 py-2 text-sm">Verificar</button>
        <ul className="mt-3 space-y-3 text-sm">
          {groups.map((g, i) => (
            <li key={i} className="rounded-lg bg-slate-800 p-3">{g.map((r) => <div key={r.id}>#{r.id} — {r.statement}</div>)}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function ConfigTab({ setMsg }: { setMsg: SetMsg }) {
  const [cfg, setCfg] = useState<Record<string, unknown> | null>(null);
  const [prizes, setPrizes] = useState("");
  const [safety, setSafety] = useState("");
  const [levels, setLevels] = useState("");
  const [phrasesText, setPhrasesText] = useState("");

  useEffect(() => {
    fetch("/api/admin/config").then((r) => r.json()).then((d) => {
      const c = d.config as Record<string, unknown>;
      setCfg(c);
      setPrizes((c.prizes as number[]).join(", "));
      setSafety((c.safetyQuestions as number[]).join(", "));
      setLevels((c.levelDifficulty as string[]).join(", "));
      setPhrasesText(JSON.stringify(c.phrases, null, 2));
    });
  }, []);

  const save = async () => {
    if (!cfg) return;
    let phrases: unknown;
    try {
      phrases = JSON.parse(phrasesText);
    } catch {
      return setMsg("Falas inválidas: use JSON com listas de textos.");
    }
    const body = {
      ...cfg,
      prizes: prizes.split(",").map((s) => Number(s.trim())),
      safetyQuestions: safety.split(",").filter((x) => x.trim() !== "").map((x) => Number(x.trim())),
      levelDifficulty: levels.split(",").map((s) => s.trim()),
      phrases,
    };
    const res = await fetch("/api/admin/config", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await res.json();
    setMsg(res.ok ? "Configuração salva e aplicada às próximas partidas." : (data.error ?? "Falha ao salvar."));
    if (res.ok) setCfg(data.config);
  };

  if (!cfg) return <p>Carregando configuração…</p>;
  const help = cfg.helpLimits as Record<string, number>;

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="space-y-4 rounded-xl border border-slate-700 p-5 text-sm">
        <label className="block"><span className="mb-1 block text-slate-300">Premiação por nível (crescente, separada por vírgula, 17 níveis)</span>
          <textarea value={prizes} onChange={(e) => setPrizes(e.target.value)} rows={3} className="w-full rounded-lg bg-slate-800 p-2" /></label>
        <label className="block"><span className="mb-1 block text-slate-300">Pontos de segurança (números das perguntas, ex.: 5, 10)</span>
          <input value={safety} onChange={(e) => setSafety(e.target.value)} className="w-full rounded-lg bg-slate-800 p-2" /></label>
        <label className="block"><span className="mb-1 block text-slate-300">Dificuldade por nível (uma por nível)</span>
          <textarea value={levels} onChange={(e) => setLevels(e.target.value)} rows={3} className="w-full rounded-lg bg-slate-800 p-2" /></label>
        <div className="grid grid-cols-2 gap-3">
          {(["cards", "fifty", "audience", "presenter"] as const).map((k) => (
            <label key={k} className="block"><span className="mb-1 block text-slate-300">Limite: {k}</span>
              <input type="number" min={0} max={10} value={help[k]} onChange={(e) => setCfg({ ...cfg, helpLimits: { ...help, [k]: Number(e.target.value) } })} className="w-full rounded-lg bg-slate-800 p-2" /></label>
          ))}
        </div>
        <div className="grid grid-cols-3 gap-3">
          <label className="block"><span className="mb-1 block text-slate-300">Tempo (s, 0 = off)</span>
            <input type="number" min={0} max={600} value={Number(cfg.timerSeconds)} onChange={(e) => setCfg({ ...cfg, timerSeconds: Number(e.target.value) })} className="w-full rounded-lg bg-slate-800 p-2" /></label>
          <label className="block"><span className="mb-1 block text-slate-300">Perguntas (rápido)</span>
            <input type="number" min={1} max={17} value={Number(cfg.quickQuestions)} onChange={(e) => setCfg({ ...cfg, quickQuestions: Number(e.target.value) })} className="w-full rounded-lg bg-slate-800 p-2" /></label>
          <label className="block"><span className="mb-1 block text-slate-300">Vidas (sobrevivência)</span>
            <input type="number" min={1} max={10} value={Number(cfg.survivalLives)} onChange={(e) => setCfg({ ...cfg, survivalLives: Number(e.target.value) })} className="w-full rounded-lg bg-slate-800 p-2" /></label>
        </div>
        <label className="block"><span className="mb-1 block text-slate-300">Frase especial</span>
          <input value={String(cfg.specialPhrase ?? "")} onChange={(e) => setCfg({ ...cfg, specialPhrase: e.target.value })} className="w-full rounded-lg bg-slate-800 p-2" /></label>
        <button onClick={save} className="rounded-lg bg-amber-400 px-5 py-2 font-bold text-slate-900">Salvar configuração</button>
      </div>
      <div className="rounded-xl border border-slate-700 p-5 text-sm">
        <span className="mb-1 block text-slate-300">Biblioteca de falas (JSON: chave → lista de frases)</span>
        <textarea value={phrasesText} onChange={(e) => setPhrasesText(e.target.value)} rows={24} className="w-full rounded-lg bg-slate-800 p-2 font-mono text-xs" />
      </div>
    </div>
  );
}

function AiTab({ setMsg }: { setMsg: SetMsg }) {
  const [status, setStatus] = useState<{ configured: boolean; model: string } | null>(null);
  const [category, setCategory] = useState("Geografia");
  const [difficulty, setDifficulty] = useState("facil");
  const [count, setCount] = useState(5);
  const [topic, setTopic] = useState("");
  const [result, setResult] = useState<unknown>(null);

  useEffect(() => {
    fetch("/api/admin/ai").then((r) => r.json()).then(setStatus);
  }, []);

  const generate = async () => {
    setMsg("Gerando perguntas com IA…");
    const res = await fetch("/api/admin/ai", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "generate", category, difficulty, count, topic }) });
    const data = await res.json();
    setResult(data);
    setMsg(res.ok ? "Perguntas geradas como inativas. Revise e aprove na aba Perguntas (status: aguardando aprovação)." : (data.error ?? "Falha na geração."));
  };

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-slate-700 p-5 text-sm">
        <p>Status do serviço: {status?.configured ? <span className="text-emerald-300">configurado ({status.model})</span> : <span className="text-amber-300">não configurado — defina AI_API_KEY no ambiente para habilitar. O jogo funciona normalmente sem IA.</span>}</p>
        <p className="mt-2 text-xs text-slate-400">A IA não é fonte de verdade: cada pergunta passa pela validação de qualidade e exige aprovação humana antes de entrar no jogo.</p>
      </div>
      <div className="grid gap-3 rounded-xl border border-slate-700 p-5 text-sm md:grid-cols-4">
        <input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Categoria" className="rounded-lg bg-slate-800 p-2" />
        <select value={difficulty} onChange={(e) => setDifficulty(e.target.value)} className="rounded-lg bg-slate-800 p-2">{DIFFS.map((d) => <option key={d} value={d}>{d}</option>)}</select>
        <input type="number" min={1} max={10} value={count} onChange={(e) => setCount(Number(e.target.value))} className="rounded-lg bg-slate-800 p-2" />
        <input value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="Tema específico (opcional)" className="rounded-lg bg-slate-800 p-2" />
        <button onClick={generate} disabled={!status?.configured} className="rounded-lg bg-sky-400 px-4 py-2 font-bold text-slate-900 disabled:opacity-40 md:col-span-4">Gerar perguntas com IA</button>
      </div>
      {result !== null && <pre className="max-h-96 overflow-auto rounded-lg bg-slate-950 p-3 text-xs">{JSON.stringify(result, null, 2)}</pre>}
    </div>
  );
}

function Card({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl bg-slate-800/70 p-4">
      <p className="text-xs text-slate-400">{label}</p>
      <p className="text-2xl font-black text-sky-200">{value}</p>
    </div>
  );
}
