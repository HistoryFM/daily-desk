import { z } from "zod";
import { config } from "../config";
import { deskTool } from "../llm";

export async function fetchText(url: string, timeoutMs = 15000): Promise<string> {
  const res = await fetch(url, {
    headers: { "User-Agent": config.userAgent, Accept: "text/html,application/xhtml+xml,application/xml,*/*" },
    signal: AbortSignal.timeout(timeoutMs),
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`GET ${new URL(url).host} failed: HTTP ${res.status}`);
  return res.text();
}

export const decode = (s: string) =>
  s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&(rsquo|lsquo);/g, "'")
    .replace(/&(rdquo|ldquo);/g, '"')
    .replace(/&mdash;/g, "—")
    .replace(/&ndash;/g, "–")
    .replace(/&hellip;/g, "…");

/** Very small readability: drops scripts/nav/etc. and returns paragraph-ish text. */
export function htmlToText(html: string, max = 8000): { title: string; text: string } {
  const title = decode(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() ?? "");
  let body = html
    .replace(/<(script|style|noscript|svg|nav|header|footer|aside|form|iframe)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");
  const article = body.match(/<article[\s\S]*?<\/article>/i)?.[0] ?? body.match(/<main[\s\S]*?<\/main>/i)?.[0];
  if (article && article.length > 1500) body = article;
  const paras = [...body.matchAll(/<(p|h[1-4]|li|blockquote)[^>]*>([\s\S]*?)<\/\1>/gi)]
    .map((m) => decode(m[2].replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim())
    .filter((t) => t.length > 40);
  const text = (paras.length > 3 ? paras.join("\n\n") : decode(body.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ")).slice(0, max);
  return { title, text };
}

export const fetchUrl = deskTool(
  "fetch_url",
  "Fetch a web page and return its readable text (truncated). Use for reading articles, docs, or primary sources.",
  z.object({ url: z.string().url() }),
  async ({ url }) => {
    const { title, text } = htmlToText(await fetchText(url));
    return { url, title, text };
  },
);

/**
 * Web search via OpenRouter's web plugin (the ":online" model variant): a cheap model
 * searches, then returns a cited digest. Cost is tracked like any other LLM call.
 */
export const webSearch = deskTool(
  "web_search",
  "Search the live web for recent or factual information. Returns a short cited digest with source URLs; follow up with fetch_url to read a source in full.",
  z.object({ query: z.string() }),
  async ({ query }) => {
    const { runAgent } = await import("../llm");
    const { text } = await runAgent({
      agent: "tool.web_search",
      modelId: `${config.modelFast}:online`,
      instructions: "You are a search engine. Using the web results, return 4-8 bullet points of the most relevant facts for the query, each ending with its source as a markdown link. No preamble.",
      prompt: query,
    });
    return { query, digest: text };
  },
);

export const hnSearch = deskTool(
  "hn_search",
  "Search Hacker News stories and discussion (good for tech/startup context and practitioner opinions).",
  z.object({ query: z.string(), recentDays: z.number().int().min(1).max(3650).optional() }),
  async ({ query, recentDays }) => {
    const since = recentDays ? `&numericFilters=created_at_i>${Math.floor(Date.now() / 1000) - recentDays * 86400}` : "";
    const res = await fetch(`https://hn.algolia.com/api/v1/search?tags=story&hitsPerPage=8&query=${encodeURIComponent(query)}${since}`, {
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) throw new Error(`HN search failed: HTTP ${res.status}`);
    const json = (await res.json()) as { hits: { title: string; url: string; points: number; num_comments: number; objectID: string; created_at: string }[] };
    return json.hits.map((h) => ({
      title: h.title,
      url: h.url,
      points: h.points,
      comments: h.num_comments,
      discussion: `https://news.ycombinator.com/item?id=${h.objectID}`,
      date: h.created_at.slice(0, 10),
    }));
  },
);
