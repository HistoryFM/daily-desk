import { z } from "zod";
import { config } from "../config";
import { deskTool } from "../llm";

const API = "https://en.wikipedia.org/w/api.php";

async function wiki(params: Record<string, string>) {
  const qs = new URLSearchParams({ format: "json", formatversion: "2", origin: "*", ...params });
  const res = await fetch(`${API}?${qs}`, { headers: { "User-Agent": config.userAgent }, signal: AbortSignal.timeout(12000) });
  if (!res.ok) throw new Error(`Wikipedia API failed: HTTP ${res.status}`);
  return res.json();
}

export const wikipediaSearch = deskTool(
  "wikipedia_search",
  "Search English Wikipedia. Returns page titles with short snippets.",
  z.object({ query: z.string() }),
  async ({ query }) => {
    const json = await wiki({ action: "query", list: "search", srsearch: query, srlimit: "6" });
    return (json.query?.search ?? []).map((r: { title: string; snippet: string }) => ({
      title: r.title,
      snippet: r.snippet.replace(/<[^>]+>/g, ""),
    }));
  },
);

export const wikipediaPage = deskTool(
  "wikipedia_page",
  "Read the plain-text content of a Wikipedia page by exact title (truncated). Optionally focus on a section keyword.",
  z.object({ title: z.string(), focus: z.string().optional() }),
  async ({ title, focus }) => {
    const json = await wiki({ action: "query", prop: "extracts", explaintext: "1", redirects: "1", titles: title });
    const page = json.query?.pages?.[0];
    if (!page || page.missing) throw new Error(`Wikipedia page not found: "${title}"`);
    let text: string = page.extract ?? "";
    if (focus) {
      const i = text.toLowerCase().indexOf(focus.toLowerCase());
      if (i > 0) text = text.slice(Math.max(0, i - 500));
    }
    return { title: page.title, url: `https://en.wikipedia.org/wiki/${encodeURIComponent(page.title.replace(/ /g, "_"))}`, text: text.slice(0, 7000) };
  },
);
