import { z } from "zod";
import { db } from "../db";
import { deskTool } from "../llm";
import { fetchText, htmlToText } from "./web";

export type ArticleRow = {
  id: number;
  url: string;
  title: string;
  source: string;
  summary: string | null;
  published_at: string | null;
  fetched_at: string;
  score: number | null;
  tags: string | null;
  one_line: string | null;
};

export const searchNews = deskTool(
  "search_news",
  "Search the local archive of news articles the desk has collected (titles + summaries). Good for 'what else happened about X'.",
  z.object({ query: z.string(), days: z.number().int().min(1).max(90).optional() }),
  async ({ query, days }) => {
    const words = query.toLowerCase().split(/\s+/).filter((w) => w.length > 2).slice(0, 5);
    if (words.length === 0) return [];
    const where = words.map(() => "(lower(title) LIKE ? OR lower(summary) LIKE ?)").join(" OR ");
    const args = words.flatMap((w) => [`%${w}%`, `%${w}%`]);
    const rows = db
      .prepare(
        `SELECT id, title, source, url, one_line, fetched_at FROM articles WHERE (${where}) AND fetched_at > datetime('now', ?) ORDER BY fetched_at DESC LIMIT 12`,
      )
      .all(...args, `-${days ?? 30} days`);
    return rows;
  },
);

export const topCandidates = deskTool(
  "get_candidates",
  "List today's highest-scored triaged articles (id, title, source, one-line summary, tags, score) not yet featured in an earlier brief today.",
  z.object({ hours: z.number().int().min(1).max(48).optional(), limit: z.number().int().min(5).max(40).optional() }),
  async ({ hours, limit }) =>
    db
      .prepare(
        `SELECT id, title, source, one_line, tags, score FROM articles
         WHERE triaged_at IS NOT NULL AND fetched_at > datetime('now', ?) AND score >= 5
         ORDER BY score DESC, fetched_at DESC LIMIT ?`,
      )
      .all(`-${hours ?? 24} hours`, limit ?? 25),
);

export const readArticle = deskTool(
  "read_article",
  "Read the full text of an article from the archive by id (fetches the page; may fail on paywalls).",
  z.object({ id: z.number().int() }),
  async ({ id }) => {
    const a = db.prepare("SELECT * FROM articles WHERE id = ?").get(id) as ArticleRow | undefined;
    if (!a) throw new Error(`No article with id ${id}`);
    const { text } = htmlToText(await fetchText(a.url), 6000);
    return { id, title: a.title, source: a.source, url: a.url, text: text || a.summary };
  },
);

export const previousBriefs = deskTool(
  "previous_briefs",
  "Read the desk's previous briefs (most recent first) to keep continuity across days.",
  z.object({ count: z.number().int().min(1).max(5).optional() }),
  async ({ count }) =>
    db
      .prepare("SELECT date, edition, headline, substr(markdown, 1, 2500) AS excerpt FROM briefs ORDER BY created_at DESC LIMIT ?")
      .all(count ?? 2),
);
