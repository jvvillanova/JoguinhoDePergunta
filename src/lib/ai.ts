/**
 * Serviço de IA (opcional). Usa qualquer API compatível com OpenAI Chat Completions:
 *   AI_API_KEY (ou OPENAI_API_KEY), AI_BASE_URL (padrão: https://api.openai.com/v1), AI_MODEL.
 * A IA NÃO é fonte de verdade: toda pergunta gerada passa por validateQuestion e exige
 * aprovação humana antes de ficar ativa. Sem chave, o recurso fica desabilitado sem afetar o jogo.
 */
import { DIFFICULTIES } from "@/lib/config";
import type { QuestionInput } from "@/lib/bank/quality";

const apiKey = () => process.env.AI_API_KEY || process.env.OPENAI_API_KEY || "";
const baseUrl = () => (process.env.AI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
const model = () => process.env.AI_MODEL || "gpt-4o-mini";

export function aiStatus() {
  return { configured: apiKey().length > 0, model: model() };
}

async function chatJson(system: string, user: string): Promise<unknown> {
  const key = apiKey();
  if (!key) throw new Error("Serviço de IA não configurado (defina AI_API_KEY no ambiente).");
  const res = await fetch(`${baseUrl()}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: model(),
      temperature: 0.4,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
    signal: AbortSignal.timeout(90_000),
  });
  if (!res.ok) throw new Error(`Falha no serviço de IA (HTTP ${res.status}).`);
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const content = data.choices?.[0]?.message?.content ?? "";
  try {
    return JSON.parse(content);
  } catch {
    throw new Error("A IA retornou um formato inválido.");
  }
}

const GENERATION_SYSTEM = `Você cria perguntas de conhecimentos gerais em português do Brasil para um jogo de perguntas e respostas.
Regras obrigatórias:
- Exatamente 4 alternativas (A, B, C, D) e apenas UMA correta.
- Alternativas plausíveis, sem "todas as anteriores" ou "nenhuma das anteriores".
- Enunciado claro, sem ambiguidades, terminando com "?".
- Justificativa factual curta explicando por que a alternativa correta está certa.
- Fonte: indique uma referência real e conhecida (ex.: IBGE, Enciclopédia Britânica, ONU, Constituição Federal). Nunca invente fontes.
- Use fatos estáveis e verificáveis; evite temas que mudam com o tempo.
Responda somente com JSON no formato {"questions":[{"statement":"","options":{"A":"","B":"","C":"","D":""},"correct":"A|B|C|D","justification":"","source":"","tags":[""]}]}`;

export async function generateQuestions(params: {
  category: string;
  difficulty: string;
  count: number;
  topic?: string;
}): Promise<QuestionInput[]> {
  if (!DIFFICULTIES.includes(params.difficulty as (typeof DIFFICULTIES)[number])) {
    throw new Error("Dificuldade inválida.");
  }
  const count = Math.min(Math.max(params.count, 1), 10);
  const user = `Categoria: ${params.category}
Dificuldade: ${params.difficulty}
Tema específico (opcional): ${params.topic || "livre dentro da categoria"}
Quantidade: ${count}`;
  const data = (await chatJson(GENERATION_SYSTEM, user)) as { questions?: unknown[] };
  const list = Array.isArray(data.questions) ? data.questions : [];
  return list.slice(0, count).map((raw) => {
    const q = raw as Record<string, unknown>;
    const opts = (q.options ?? {}) as Record<string, unknown>;
    return {
      category: params.category,
      difficulty: params.difficulty,
      statement: String(q.statement ?? ""),
      options: {
        A: String(opts.A ?? ""),
        B: String(opts.B ?? ""),
        C: String(opts.C ?? ""),
        D: String(opts.D ?? ""),
      },
      correct: String(q.correct ?? "").toUpperCase(),
      justification: String(q.justification ?? ""),
      source: String(q.source ?? ""),
      tags: Array.isArray(q.tags) ? q.tags.map((t) => String(t).toLowerCase()) : [],
      author: `IA (${model()})`,
    } as QuestionInput;
  });
}

/** Revisão automática: sinaliza possíveis erros para análise humana (não decide a verdade). */
export async function reviewQuestion(q: QuestionInput): Promise<{ verdict: string; issues: string[] }> {
  const system = `Você revisa perguntas de quiz. Verifique se a alternativa marcada é factualmente correta, se há outra alternativa também correta, ambiguidade, duplicidade ou informação desatualizada. Responda somente JSON: {"verdict":"ok|revisar|reprovada","issues":["..."]}.`;
  const data = (await chatJson(system, JSON.stringify(q))) as { verdict?: string; issues?: unknown[] };
  return {
    verdict: String(data.verdict ?? "revisar"),
    issues: Array.isArray(data.issues) ? data.issues.map((i) => String(i)) : [],
  };
}
