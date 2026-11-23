import { XMLParser } from "fast-xml-parser";
import { db } from "./db";
import { decode, fetchText } from "./tools/web";

export const FEEDS: { name: string; url: string }[] = [
  { name: "Hacker News", url: "https://hnrss.org/frontpage?points=150" },
  { name: "TechCrunch", url: "https://techcrunch.com/feed/" },
  { name: "The Verge", url: "https://www.theverge.com/rss/index.xml" },
  { name: "Ars Technica", url: "https://feeds.arstechnica.com/arstechnica/index" },
  { name: "Simon Willison", url: "https://simonwillison.net/atom/everything/" },
  { name: "Stratechery", url: "https://stratechery.com/feed/" },
  { name: "BBC Business", url: "https://feeds.bbci.co.uk/news/business/rss.xml" },
  { name: "CNBC", url: "https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=100003114" },
  { name: "ET Tech", url: "https://economictimes.indiatimes.com/tech/rssfeeds/13357270.cms" },
  { name: "Mint Companies", url: "https://www.livemint.com/rss/companies" },
];

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@" });

type Item = { title: string; url: string; summary: string; published?: string };

const str = (v: unknown): string => {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  if (typeof v === "object" && "#text" in (v as object)) return String((v as { "#text": unknown })["#text"]);
  return "";
};
const arr = <T,>(v: T | T[] | undefined): T[] => (v == null ? [] : Array.isArray(v) ? v : [v]);
const clean = (s: string) => decode(decode(s).replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim().slice(0, 600);

export function parseFeed(xml: string): Item[] {
  const doc = parser.parse(xml);
  if (doc.rss) {
    return arr(doc.rss.channel?.item).map((i: Record<string, unknown>) => ({
      title: clean(str(i.title)),
      url: str(i.link).trim(),
      summary: clean(str(i.description)),
      published: str(i.pubDate) || undefined,
    }));
  }
  if (doc.feed) {
    return arr(doc.feed.entry).map((e: Record<string, unknown>) => {
      const links = arr(e.link as Record<string, string> | Record<string, string>[]);
      const link = links.find((l) => !l["@rel"] || l["@rel"] === "alternate") ?? links[0];
      return {
        title: clean(str(e.title)),
        url: (link?.["@href"] ?? "").trim(),
        summary: clean(str(e.summary) || str(e.content)),
        published: str(e.published) || str(e.updated) || undefined,
      };
    });
  }
  throw new Error("Unrecognised feed format");
}

/** Fetch all feeds in parallel; failures are reported per feed but don't stop the run. */
export async function fetchAllFeeds() {
  const insert = db.prepare(
    "INSERT OR IGNORE INTO articles(url, title, source, summary, published_at) VALUES (?, ?, ?, ?, ?)",
  );
  let added = 0;
  const failures: string[] = [];
  await Promise.all(
    FEEDS.map((feed) =>
      (async () => {
        try {
          const items = parseFeed(await fetchText(feed.url));
          for (const it of items.slice(0, 40)) {
            if (!it.url || !it.title) continue;
            const published = it.published ? new Date(it.published) : null;
            const iso = published && !isNaN(+published) ? published.toISOString() : null;
            added += insert.run(it.url, it.title, feed.name, it.summary, iso).changes;
          }
        } catch (err) {
          failures.push(feed.name);
          console.error(`[desk] feed ${feed.name} failed:`, err instanceof Error ? err.message : err);
        }
      })(),
    ),
  );
  console.log(`[desk] fetched feeds: ${added} new articles, ${failures.length} failed`);
  return { added, failures };
}
