import { execFile } from "node:child_process";
import { z } from "zod";
import { config, localDate } from "../config";
import { db } from "../db";
import { fetchAllFeeds } from "../feeds";
import { parseJson, runAgent } from "../llm";
import { PROFILE } from "../profile";
import { previousBriefs, readArticle, searchNews, topCandidates } from "../tools/news";
import { hnSearch } from "../tools/web";

const TriageSchema = z.array(
  z.object({
    id: z.number().int(),
    score: z.number().min(0).max(10),
    tags: z.array(z.string()).max(4),
    one_line: z.string(),
  }),
);

/** Single-turn agent: score + tag untriaged articles in batches. */
export async function triage() {
  const pending = db
    .prepare("SELECT id, title, source, substr(summary, 1, 300) AS summary FROM articles WHERE triaged_at IS NULL AND fetched_at > datetime('now', '-2 days') ORDER BY id DESC LIMIT 150")
    .all() as { id: number; title: string; source: string; summary: string | null }[];
  const update = db.prepare("UPDATE articles SET score = ?, tags = ?, one_line = ?, triaged_at = datetime('now') WHERE id = ?");
  let done = 0;
  for (let i = 0; i < pending.length; i += 25) {
    const batch = pending.slice(i, i + 25);
    const { text } = await runAgent({
      agent: "wire.triage",
      instructions: `You are the triage desk for a personal news brief.\n\nReader profile:\n${PROFILE}\n\nScore each item 0-10 for how much THIS reader would want it in today's brief (10 = must read; 0 = irrelevant, listicle, deal post, or gadget review). Tag with 1-3 short lowercase topic tags. Write a neutral one_line summary (max 20 words). Return ONLY a JSON array of {id, score, tags, one_line}.`,
      prompt: JSON.stringify(batch),
    });
    const rows = parseJson(text, TriageSchema);
    const tx = db.transaction(() => {
      for (const r of rows) update.run(r.score, r.tags.join(","), r.one_line, r.id);
    });
    tx();
    done += rows.length;
  }
  return { triaged: done };
}

/** Multi-step agent: the editor researches candidates and writes the brief. */
export async function writeBrief(edition: "morning" | "evening") {
  const date = localDate();
  const morning = edition === "morning";
  const { text, steps } = await runAgent({
    agent: `wire.editor.${edition}`,
    modelId: config.modelSmart,
    maxSteps: 14,
    tools: { get_candidates: topCandidates, read_article: readArticle, search_news: searchNews, previous_briefs: previousBriefs, hn_search: hnSearch },
    instructions: `You are the editor of "The Daily Desk", a private ${morning ? "morning brief" : "evening wrap"} for one reader.\n\nReader profile:\n${PROFILE}\n\nProcess:\n1. Call get_candidates (hours=${morning ? 24 : 12}). Call previous_briefs to avoid repeating yesterday and to note continuing stories.\n2. Pick ${morning ? "5-7" : "3-4"} stories. Read the 3-4 most important with read_article (skip if it fails — work from the summary). Use hn_search or search_news only where context genuinely helps.\n3. Write the brief in Markdown:\n   - First line: "# " + a sharp headline for the whole ${morning ? "morning" : "evening"} (not a story title).\n   - A 2-sentence italic dek setting the day's theme.\n   - Then "## " sections per story: what happened, then **Why it matters** (mechanism, incentives, second-order effects). Link the source inline like [Source](url).\n   - End with "## On the radar" — 3 one-line bullets for smaller items.\n   - Mark continuing stories with "(continuing)".\nKeep it under ${morning ? 900 : 450} words. No preamble, output only the brief.`,
    prompt: `Today is ${new Date().toDateString()}. Write the ${edition} edition.`,
  });
  const markdown = text.trim().replace(/^```(?:markdown)?\s*|```$/g, "");
  if (markdown.length < 200) throw new Error(`Editor produced an implausibly short brief (${markdown.length} chars)`);
  const headline = markdown.match(/^#\s+(.+)$/m)?.[1] ?? `${edition} brief`;
  const used = new Set<number>();
  for (const s of steps) for (const c of s.toolCalls ?? []) if (c.toolName === "read_article") used.add((c.input as { id: number }).id);
  db.prepare(
    "INSERT INTO briefs(date, edition, headline, markdown, article_ids) VALUES (?,?,?,?,?) ON CONFLICT(date, edition) DO UPDATE SET headline=excluded.headline, markdown=excluded.markdown, article_ids=excluded.article_ids, created_at=datetime('now')",
  ).run(date, edition, headline, markdown, JSON.stringify([...used]));
  console.log(`[desk] ${edition} brief written: ${headline}`);
  if (config.notify) notify("The Daily Desk", headline);
  return { headline, words: markdown.split(/\s+/).length, steps: steps.length };
}

export async function runWire(edition: "morning" | "evening") {
  const fetched = await fetchAllFeeds();
  const triaged = await triage();
  const brief = await writeBrief(edition);
  return { ...fetched, ...triaged, ...brief };
}

export async function refreshWire() {
  const fetched = await fetchAllFeeds();
  const triaged = await triage();
  return { ...fetched, ...triaged };
}

function notify(title: string, message: string) {
  if (process.platform !== "darwin") return;
  const esc = (s: string) => s.replace(/["\\]/g, "");
  execFile("osascript", ["-e", `display notification "${esc(message)}" with title "${esc(title)}"`], () => {});
}

export function latestBrief() {
  return db.prepare("SELECT * FROM briefs ORDER BY created_at DESC LIMIT 1").get() as
    | { id: number; date: string; edition: string; headline: string; markdown: string; created_at: string }
    | undefined;
}
