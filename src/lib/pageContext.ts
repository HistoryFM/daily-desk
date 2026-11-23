import { formatYear, localDate } from "./config";
import { getConversation } from "./conversations";
import { db } from "./db";

/**
 * What the reader was looking at when they opened the ask panel, rebuilt on the server from
 * the database (not scraped from the DOM) so the agent sees the full text of the page.
 */
export type PageFocus = { article?: number };

export type PageContext = {
  agent: "explainer" | "tutor";
  label: string;
  context: string;
  /** Suggested thread title when the page focuses on one item (e.g. an article). */
  title?: string;
};

const MAX = 12_000;

type Brief = { id: number; edition: string; headline: string; markdown: string; created_at: string };

function briefContext(b: Brief | undefined, label: string): PageContext {
  if (!b) return { agent: "explainer", label, context: "The page is empty: no brief has been written yet." };
  return {
    agent: "explainer",
    label: `${b.edition === "morning" ? "Morning brief" : "Evening wrap"}: ${b.headline}`,
    context: `The ${b.edition} ${b.edition === "morning" ? "brief" : "wrap"} the desk wrote for the reader:\n\n${b.markdown}`,
  };
}

function articleContext(id: number): string | null {
  const a = db.prepare("SELECT title, url, source, one_line, summary, published_at FROM articles WHERE id = ?").get(id) as
    | { title: string; url: string; source: string; one_line: string | null; summary: string | null; published_at: string | null }
    | undefined;
  if (!a) return null;
  return `Article: "${a.title}" (${a.source}${a.published_at ? `, ${a.published_at.slice(0, 10)}` : ""})\nURL: ${a.url}\n${a.one_line ? `Desk summary: ${a.one_line}\n` : ""}${a.summary ? `Feed excerpt: ${a.summary.slice(0, 1500)}` : ""}`;
}

export function buildPageContext(page: string, focus?: PageFocus): PageContext {
  const url = new URL(page, "http://desk.local");
  const path = url.pathname;
  let ctx: PageContext;

  if (path === "/") {
    const b = db.prepare("SELECT * FROM briefs ORDER BY created_at DESC LIMIT 1").get() as Brief | undefined;
    ctx = briefContext(b, "Today");
  } else if (path.startsWith("/wire")) {
    const bid = url.searchParams.get("b");
    if (bid && url.searchParams.get("tab") !== "pile") {
      ctx = briefContext(db.prepare("SELECT * FROM briefs WHERE id = ?").get(Number(bid)) as Brief | undefined, "Wire");
    } else {
      const pile = db
        .prepare("SELECT id, title, source, one_line, score FROM articles WHERE fetched_at > datetime('now', '-36 hours') ORDER BY (score IS NULL), score DESC LIMIT 40")
        .all() as { id: number; title: string; source: string; one_line: string | null; score: number | null }[];
      ctx = {
        agent: "explainer",
        label: "The pile",
        context: `The reader is looking at "the pile": every article the desk read in the last 36 hours, ranked by relevance to them (score 0-10).\n\n${pile
          .map((a) => `- [${a.score ?? "–"}] ${a.title} (${a.source})${a.one_line ? ` — ${a.one_line}` : ""}`)
          .join("\n")}`,
      };
    }
  } else if (path.startsWith("/history")) {
    const d = url.searchParams.get("d");
    const card = (d
      ? db.prepare("SELECT * FROM history_cards WHERE date = ?").get(d)
      : db.prepare("SELECT * FROM history_cards ORDER BY date DESC LIMIT 1").get()) as { year: number; markdown: string } | undefined;
    ctx = card
      ? {
          agent: "tutor",
          label: `Meanwhile… ${formatYear(card.year)}`,
          context: `The reader is reading today's "Meanwhile…" card for ${formatYear(card.year)}:\n\n${card.markdown}`,
        }
      : { agent: "tutor", label: "History", context: "No history card has been written yet." };
  } else if (path.startsWith("/shelf")) {
    const series = db
      .prepare("SELECT s.title, s.source, s.last_chapter, (SELECT COUNT(*) FROM chapters c WHERE c.series_id = s.id AND c.seen = 0) AS unseen FROM series s ORDER BY s.title")
      .all() as { title: string; source: string; last_chapter: string | null; unseen: number }[];
    const recs = db.prepare("SELECT title, format, reason FROM recommendations WHERE dismissed = 0 ORDER BY id DESC LIMIT 8").all() as {
      title: string;
      format: string;
      reason: string;
    }[];
    ctx = {
      agent: "explainer",
      label: "Your shelf",
      context: `The reader's manga/webtoon shelf.\n\nTracking:\n${series.map((s) => `- ${s.title} (${s.source}; latest ${s.last_chapter ?? "unknown"}; ${s.unseen} unread)`).join("\n") || "- nothing yet"}\n\nThe desk's current recommendations:\n${recs.map((r) => `- ${r.title} [${r.format}]: ${r.reason}`).join("\n") || "- none yet"}`,
    };
  } else if (path.startsWith("/system")) {
    const runs = db
      .prepare("SELECT job, trigger, status, started_at, finished_at, substr(coalesce(detail,''),1,300) AS detail FROM job_runs ORDER BY id DESC LIMIT 25")
      .all() as { job: string; trigger: string; status: string; started_at: string; finished_at: string | null; detail: string }[];
    const spend = db
      .prepare("SELECT agent, COUNT(*) AS calls, ROUND(SUM(cost_usd), 4) AS usd, SUM(input_tokens) AS input, SUM(output_tokens) AS output FROM llm_usage WHERE date = ? GROUP BY agent ORDER BY usd DESC")
      .all(localDate()) as { agent: string; calls: number; usd: number; input: number; output: number }[];
    ctx = {
      agent: "explainer",
      label: "System",
      context: `The reader is on the desk's System page: the agents' own job runs and LLM spend. The desk is a local Next.js app whose scheduler runs agent jobs; times are UTC.\n\nSpend today by agent:\n${spend.map((s) => `- ${s.agent}: $${s.usd} over ${s.calls} calls (${s.input} in / ${s.output} out tokens)`).join("\n") || "- nothing yet"}\n\nRecent job runs:\n${runs.map((r) => `- ${r.started_at} ${r.job} (${r.trigger}) → ${r.status} ${r.detail}`).join("\n")}`,
    };
  } else if (path.startsWith("/ask/")) {
    const c = getConversation(path.split("/")[2] ?? "");
    const transcript = c?.messages.map((m) => `${m.role === "user" ? "Q" : "A"}: ${m.parts.map((p) => p.text ?? "").join(" ")}`).join("\n\n") ?? "";
    ctx = {
      agent: c?.agent === "tutor" ? "tutor" : "explainer",
      label: c ? `Thread: ${c.title}` : "A thread",
      context: c ? `The reader is looking at an earlier thread, "${c.title}":\n\n${transcript}` : "",
    };
  } else {
    ctx = { agent: "explainer", label: "The desk", context: "" };
  }

  if (focus?.article) {
    const a = articleContext(focus.article);
    if (a) {
      const t = db.prepare("SELECT title FROM articles WHERE id = ?").get(focus.article) as { title: string };
      ctx = { agent: "explainer", label: ctx.label, title: t.title, context: `The reader picked this story to dig into:\n${a}\n\n---\nFor reference, the page it came from:\n${ctx.context}` };
    }
  }
  return { ...ctx, context: ctx.context.slice(0, MAX) };
}
