import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";

export const users = pgTable(
  "users",
  {
    id: serial("id").primaryKey(),
    username: varchar("username", { length: 40 }).notNull(),
    passwordHash: text("password_hash").notNull(),
    role: varchar("role", { length: 10 }).notNull().default("player"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("users_username_uq").on(t.username)],
);

export const sessions = pgTable(
  "sessions",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    userId: integer("user_id").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

export const categories = pgTable(
  "categories",
  {
    id: serial("id").primaryKey(),
    slug: varchar("slug", { length: 80 }).notNull(),
    name: varchar("name", { length: 120 }).notNull(),
    active: boolean("active").notNull().default(true),
  },
  (t) => [uniqueIndex("categories_slug_uq").on(t.slug)],
);

export const questions = pgTable(
  "questions",
  {
    id: serial("id").primaryKey(),
    statement: text("statement").notNull(),
    normalizedKey: varchar("normalized_key", { length: 400 }).notNull(),
    category: varchar("category", { length: 80 }).notNull(),
    subcategory: varchar("subcategory", { length: 120 }).notNull().default(""),
    difficulty: varchar("difficulty", { length: 20 }).notNull(),
    optionA: text("option_a").notNull(),
    optionB: text("option_b").notNull(),
    optionC: text("option_c").notNull(),
    optionD: text("option_d").notNull(),
    correctOption: varchar("correct_option", { length: 1 }).notNull(),
    justification: text("justification").notNull().default(""),
    hint: text("hint").notNull().default(""),
    source: text("source").notNull().default(""),
    verifiedAt: varchar("verified_at", { length: 10 }).notNull().default(""),
    author: varchar("author", { length: 120 }).notNull().default("equipe"),
    validationStatus: varchar("validation_status", { length: 30 }).notNull().default("pendente"),
    tags: jsonb("tags").$type<string[]>().notNull().default([]),
    language: varchar("language", { length: 5 }).notNull().default("pt-BR"),
    license: varchar("license", { length: 120 }).notNull().default("Original do projeto"),
    active: boolean("active").notNull().default(true),
    timesAsked: integer("times_asked").notNull().default(0),
    timesCorrect: integer("times_correct").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("questions_normalized_key_uq").on(t.normalizedKey),
    index("questions_difficulty_idx").on(t.difficulty, t.active),
    index("questions_category_idx").on(t.category),
  ],
);

export const games = pgTable(
  "games",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    userId: integer("user_id").notNull(),
    mode: varchar("mode", { length: 20 }).notNull(),
    status: varchar("status", { length: 20 }).notNull(),
    phase: varchar("phase", { length: 20 }).notNull(),
    version: integer("version").notNull().default(0),
    state: jsonb("state").$type<Record<string, unknown>>().notNull(),
    prize: integer("prize").notNull().default(0),
    correctCount: integer("correct_count").notNull().default(0),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
  },
  (t) => [index("games_user_status_idx").on(t.userId, t.status)],
);

export const settings = pgTable("settings", {
  key: varchar("key", { length: 80 }).primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const answerLog = pgTable(
  "answer_log",
  {
    id: serial("id").primaryKey(),
    gameId: varchar("game_id", { length: 36 }).notNull(),
    userId: integer("user_id").notNull(),
    questionId: integer("question_id").notNull(),
    chosen: varchar("chosen", { length: 1 }).notNull(),
    correct: boolean("correct").notNull(),
    responseMs: integer("response_ms").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("answer_log_user_idx").on(t.userId), index("answer_log_game_idx").on(t.gameId)],
);

export const dailyResults = pgTable(
  "daily_results",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").notNull(),
    day: varchar("day", { length: 10 }).notNull(),
    correctCount: integer("correct_count").notNull(),
    total: integer("total").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("daily_user_day_uq").on(t.userId, t.day)],
);
