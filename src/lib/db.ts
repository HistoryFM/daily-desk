import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

const g = globalThis as unknown as { __deskDb?: Database.Database };

function open(): Database.Database {
  const dir = path.join(process.cwd(), "data");
  fs.mkdirSync(dir, { recursive: true });
  const db = new Database(path.join(dir, "desk.db"));
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");
  db.exec(SCHEMA);
  return db;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS articles (
  id INTEGER PRIMARY KEY,
  url TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  source TEXT NOT NULL,
  summary TEXT,
  published_at TEXT,
  fetched_at TEXT NOT NULL DEFAULT (datetime('now')),
  score REAL,
  tags TEXT,
  one_line TEXT,
  triaged_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_articles_fetched ON articles(fetched_at);

CREATE TABLE IF NOT EXISTS briefs (
  id INTEGER PRIMARY KEY,
  date TEXT NOT NULL,
  edition TEXT NOT NULL,
  headline TEXT,
  markdown TEXT NOT NULL,
  article_ids TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(date, edition)
);

CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  agent TEXT NOT NULL,
  source TEXT NOT NULL,
  title TEXT NOT NULL,
  context TEXT,
  messages TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS history_cards (
  id INTEGER PRIMARY KEY,
  date TEXT UNIQUE NOT NULL,
  year INTEGER NOT NULL,
  markdown TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS quiz_items (
  id INTEGER PRIMARY KEY,
  card_date TEXT,
  question TEXT NOT NULL,
  choices TEXT NOT NULL,
  answer INTEGER NOT NULL,
  explanation TEXT,
  box INTEGER NOT NULL DEFAULT 0,
  due TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  correct INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS series (
  id INTEGER PRIMARY KEY,
  source TEXT NOT NULL,
  external_id TEXT NOT NULL,
  title TEXT NOT NULL,
  url TEXT,
  cover TEXT,
  notes TEXT,
  last_chapter TEXT,
  last_checked TEXT,
  added_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(source, external_id)
);

CREATE TABLE IF NOT EXISTS chapters (
  id INTEGER PRIMARY KEY,
  series_id INTEGER NOT NULL,
  external_id TEXT NOT NULL,
  label TEXT NOT NULL,
  url TEXT,
  published_at TEXT,
  seen INTEGER NOT NULL DEFAULT 0,
  found_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(series_id, external_id)
);

CREATE TABLE IF NOT EXISTS recommendations (
  id INTEGER PRIMARY KEY,
  date TEXT NOT NULL,
  title TEXT NOT NULL,
  format TEXT,
  reason TEXT,
  url TEXT,
  cover TEXT,
  dismissed INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS llm_usage (
  id INTEGER PRIMARY KEY,
  date TEXT NOT NULL,
  ts TEXT NOT NULL DEFAULT (datetime('now')),
  agent TEXT NOT NULL,
  model TEXT NOT NULL,
  input_tokens INTEGER,
  output_tokens INTEGER,
  cost_usd REAL NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_usage_date ON llm_usage(date);

CREATE TABLE IF NOT EXISTS job_runs (
  id INTEGER PRIMARY KEY,
  job TEXT NOT NULL,
  slot TEXT NOT NULL,
  trigger TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at TEXT,
  detail TEXT
);
CREATE INDEX IF NOT EXISTS idx_runs_job ON job_runs(job, slot);

CREATE TABLE IF NOT EXISTS kv (
  key TEXT PRIMARY KEY,
  value TEXT
);
`;

export const db: Database.Database = g.__deskDb ?? (g.__deskDb = open());

export function kvGet(key: string): string | undefined {
  const row = db.prepare("SELECT value FROM kv WHERE key = ?").get(key) as { value: string } | undefined;
  return row?.value;
}

export function kvSet(key: string, value: string) {
  db.prepare("INSERT INTO kv(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value);
}
