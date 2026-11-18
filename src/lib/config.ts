import { eq } from "drizzle-orm";
import { db } from "@/db";
import { settings } from "@/db/schema";

/** Premiação fictícia (pontuação virtual). Totalmente configurável no painel. */
export const DEFAULT_PRIZES = [
  1000, 2000, 3000, 4000, 5000, 10000, 20000, 30000, 40000, 50000, 100000, 200000, 300000, 400000,
  500000, 750000, 1000000,
];

export const DIFFICULTIES = [
  "muito_facil",
  "facil",
  "intermediaria",
  "dificil",
  "muito_dificil",
  "especialista",
] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];

export const DIFFICULTY_LABELS: Record<Difficulty, string> = {
  muito_facil: "Muito fácil",
  facil: "Fácil",
  intermediaria: "Intermediária",
  dificil: "Difícil",
  muito_dificil: "Muito difícil",
  especialista: "Especialista",
};

/** Dificuldade-alvo por nível de premiação (índice 0 = pergunta 1). */
export const DEFAULT_LEVEL_DIFFICULTY: Difficulty[] = [
  "muito_facil", "muito_facil", "facil", "facil", "facil",
  "intermediaria", "intermediaria", "intermediaria", "dificil", "dificil",
  "dificil", "muito_dificil", "muito_dificil", "muito_dificil", "especialista",
  "especialista", "especialista",
];

export type HelpLimits = { cards: number; fifty: number; audience: number; presenter: number };

export type Phrases = Record<string, string[]>;

export type GameConfig = {
  prizes: number[];
  /** Frase especial personalizável (ex.: "Valendo um milhão de taliaruras duras!"). */
  specialPhrase: string;
  /** Números de pergunta (1-based) que funcionam como ponto de segurança. */
  safetyQuestions: number[];
  levelDifficulty: Difficulty[];
  helpLimits: HelpLimits;
  timerSeconds: number; // 0 = desabilitado
  infiniteMode: { enabled: boolean };
  quickQuestions: number;
  survivalLives: number;
  phrases: Phrases;
};

export const DEFAULT_PHRASES: Phrases = {
  welcome: ["Boa noite, boa noite! Seja bem-vindo ao nosso palco de conhecimento!"],
  question: ["Vamos para a próxima pergunta?", "Olha só a pergunta que preparei para você!"],
  hard: ["Atenção, porque essa é difícil!", "Respire fundo, essa vale muito!"],
  value: ["Olha só o valor que está em jogo!", "Essa vale um milhão!"],
  confirmPrompt: ["Tem certeza da sua resposta?", "É sua resposta definitiva?"],
  locked: ["Não é possível voltar atrás!", "Resposta confirmada, agora é torcer!"],
  suspense: ["Vamos ver se você acertou!", "Suspense total...", "Será que é isso mesmo?"],
  correct: ["Certa resposta!", "Isso aí, você acertou!", "Parabéns, resposta certa!"],
  wrong: ["Você errou!", "Que pena, não foi dessa vez!"],
  help: ["Você deseja utilizar uma ajuda?", "Vamos consultar a plateia?", "Posso perguntar?"],
  encourage: ["Você está indo muito bem!", "Continue assim, você é craque!"],
  top: ["Parabéns, você chegou ao topo!"],
  walkaway: ["Decisão sábia, leve o que conquistou!"],
};

export const DEFAULT_CONFIG: GameConfig = {
  prizes: DEFAULT_PRIZES,
  specialPhrase: "Valendo um milhão de taliaruras duras!",
  safetyQuestions: [5, 10],
  levelDifficulty: DEFAULT_LEVEL_DIFFICULTY,
  helpLimits: { cards: 1, fifty: 1, audience: 1, presenter: 1 },
  timerSeconds: 0,
  infiniteMode: { enabled: true },
  quickQuestions: 5,
  survivalLives: 3,
  phrases: DEFAULT_PHRASES,
};

const CONFIG_KEY = "game_config";

export async function getConfig(): Promise<GameConfig> {
  const rows = await db.select().from(settings).where(eq(settings.key, CONFIG_KEY)).limit(1);
  const stored = (rows[0]?.value ?? {}) as Partial<GameConfig>;
  return {
    ...DEFAULT_CONFIG,
    ...stored,
    helpLimits: { ...DEFAULT_CONFIG.helpLimits, ...(stored.helpLimits ?? {}) },
    phrases: { ...DEFAULT_PHRASES, ...(stored.phrases ?? {}) },
  };
}

/** Valida a configuração antes de persistir. Lança Error com mensagem em português. */
export function validateConfig(input: GameConfig): GameConfig {
  const { prizes, safetyQuestions, levelDifficulty, helpLimits } = input;
  if (!Array.isArray(prizes) || prizes.length < 1 || prizes.length > 100) {
    throw new Error("A tabela de premiação deve ter entre 1 e 100 níveis.");
  }
  for (let i = 0; i < prizes.length; i++) {
    if (!Number.isInteger(prizes[i]) || prizes[i] < 0) throw new Error(`Premiação inválida no nível ${i + 1}.`);
    if (i > 0 && prizes[i] < prizes[i - 1]) throw new Error("A premiação deve ser crescente.");
  }
  for (const s of safetyQuestions) {
    if (!Number.isInteger(s) || s < 1 || s > prizes.length) {
      throw new Error(`Ponto de segurança inválido: ${s}.`);
    }
  }
  if (new Set(safetyQuestions).size !== safetyQuestions.length) throw new Error("Pontos de segurança repetidos.");
  if (levelDifficulty.length !== prizes.length) throw new Error("Defina a dificuldade de cada nível.");
  for (const d of levelDifficulty) {
    if (!DIFFICULTIES.includes(d)) throw new Error(`Dificuldade desconhecida: ${d}.`);
  }
  for (const [k, v] of Object.entries(helpLimits)) {
    if (!Number.isInteger(v) || v < 0 || v > 10) throw new Error(`Limite inválido para ajuda ${k}.`);
  }
  if (!Number.isInteger(input.timerSeconds) || input.timerSeconds < 0 || input.timerSeconds > 600) {
    throw new Error("Tempo por pergunta deve estar entre 0 e 600 segundos.");
  }
  if (input.quickQuestions < 1 || input.quickQuestions > prizes.length) throw new Error("Quantidade inválida no modo rápido.");
  if (input.survivalLives < 1 || input.survivalLives > 10) throw new Error("Vidas no modo sobrevivência devem estar entre 1 e 10.");
  return {
    ...input,
    safetyQuestions: [...safetyQuestions].sort((a, b) => a - b),
  };
}

export async function saveConfig(input: GameConfig): Promise<GameConfig> {
  const valid = validateConfig(input);
  await db
    .insert(settings)
    .values({ key: CONFIG_KEY, value: valid, updatedAt: new Date() })
    .onConflictDoUpdate({ target: settings.key, set: { value: valid, updatedAt: new Date() } });
  return valid;
}
