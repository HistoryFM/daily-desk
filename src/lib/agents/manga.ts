import { z } from "zod";
import { config, localDate } from "../config";
import { db } from "../db";
import { parseFeed } from "../feeds";
import { deskTool, parseJson, runAgent } from "../llm";
import { PROFILE } from "../profile";
import { fetchText } from "../tools/web";

export type SeriesRow = {
  id: number;
  source: "mangadex" | "webtoon";
  external_id: string;
  title: string;
  url: string | null;
  cover: string | null;
  notes: string | null;
  last_chapter: string | null;
  last_checked: string | null;
};

const MD = "https://api.mangadex.org";
async function md(path: string) {
  const res = await fetch(`${MD}${path}`, { headers: { "User-Agent": config.userAgent }, signal: AbortSignal.timeout(12000) });
  if (!res.ok) throw new Error(`MangaDex ${path.split("?")[0]} failed: HTTP ${res.status}`);
  return res.json();
}

type MdManga = {
  id: string;
  attributes: { title: Record<string, string>; altTitles: Record<string, string>[]; description: Record<string, string>; year: number | null; status: string; tags: { attributes: { name: { en: string } } }[] };
  relationships: { type: string; attributes?: { fileName?: string } }[];
};

function mdTitle(m: MdManga) {
  return m.attributes.title.en ?? Object.values(m.attributes.title)[0] ?? m.attributes.altTitles.find((t) => t.en)?.en ?? "Untitled";
}

export async function searchMangaDex(query: string) {
  const json = (await md(`/manga?limit=8&title=${encodeURIComponent(query)}&includes[]=cover_art&order[relevance]=desc&contentRating[]=safe&contentRating[]=suggestive`)) as { data: MdManga[] };
  return json.data.map((m) => {
    const cover = m.relationships.find((r) => r.type === "cover_art")?.attributes?.fileName;
    return {
      id: m.id,
      title: mdTitle(m),
      year: m.attributes.year,
      status: m.attributes.status,
      tags: m.attributes.tags.map((t) => t.attributes.name.en).slice(0, 6),
      cover: cover ? `https://uploads.mangadex.org/covers/${m.id}/${cover}.256.jpg` : null,
      url: `https://mangadex.org/title/${m.id}`,
    };
  });
}

export function trackSeries(s: { source: SeriesRow["source"]; external_id: string; title: string; url?: string | null; cover?: string | null }) {
  db.prepare("INSERT OR IGNORE INTO series(source, external_id, title, url, cover) VALUES (?,?,?,?,?)").run(s.source, s.external_id, s.title, s.url ?? null, s.cover ?? null);
}

/** Accepts a webtoons.com series URL (…/list?title_no=123) and derives its RSS feed. */
export async function trackWebtoon(url: string) {
  const u = new URL(url);
  const titleNo = u.searchParams.get("title_no");
  if (!u.hostname.endsWith("webtoons.com") || !titleNo) throw new Error("Expected a webtoons.com series URL containing title_no=");
  const rss = `${u.origin}${u.pathname.replace(/\/list\/?$/, "")}/rss?title_no=${titleNo}`;
  const xml = await fetchText(rss);
  const title = xml.match(/<title>([^<]+)<\/title>/)?.[1]?.trim() ?? "Webtoon";
  trackSeries({ source: "webtoon", external_id: rss, title, url });
}

const insertChapter = db.prepare("INSERT OR IGNORE INTO chapters(series_id, external_id, label, url, published_at) VALUES (?,?,?,?,?)");

async function checkOne(s: SeriesRow): Promise<number> {
  let found = 0;
  const firstCheck = !s.last_checked;
  if (s.source === "mangadex") {
    const json = (await md(`/manga/${s.external_id}/feed?limit=10&translatedLanguage[]=en&order[readableAt]=desc&includeFutureUpdates=0`)) as {
      data: { id: string; attributes: { chapter: string | null; title: string | null; readableAt: string } }[];
    };
    for (const c of json.data) {
      const label = `Ch. ${c.attributes.chapter ?? "?"}${c.attributes.title ? ` — ${c.attributes.title}` : ""}`;
      found += insertChapter.run(s.id, c.id, label, `https://mangadex.org/chapter/${c.id}`, c.attributes.readableAt).changes;
    }
    if (json.data[0]) db.prepare("UPDATE series SET last_chapter = ? WHERE id = ?").run(json.data[0].attributes.chapter, s.id);
  } else {
    const items = parseFeed(await fetchText(s.external_id)).slice(0, 10);
    for (const it of items) found += insertChapter.run(s.id, it.url, it.title, it.url, it.published ? new Date(it.published).toISOString() : null).changes;
    if (items[0]) db.prepare("UPDATE series SET last_chapter = ? WHERE id = ?").run(items[0].title, s.id);
  }
  // On the very first check, everything is "new" — mark it seen so the shelf only shows real updates.
  if (firstCheck) db.prepare("UPDATE chapters SET seen = 1 WHERE series_id = ?").run(s.id);
  db.prepare("UPDATE series SET last_checked = datetime('now') WHERE id = ?").run(s.id);
  return firstCheck ? 0 : found;
}

/** Code-only job: poll every tracked series for new chapters. */
export async function checkShelf() {
  const all = db.prepare("SELECT * FROM series").all() as SeriesRow[];
  let newChapters = 0;
  let failed = 0;
  for (const s of all) {
    try {
      newChapters += await checkOne(s);
    } catch (err) {
      failed++;
      console.error(`[desk] shelf check failed for ${s.title}:`, err instanceof Error ? err.message : err);
    }
  }
  return { series: all.length, newChapters, failed };
}

// ---------- recommender (multi-step agent) ----------

async function anilist(query: string, variables: Record<string, unknown>) {
  const res = await fetch("https://graphql.anilist.co", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(12000),
  });
  if (!res.ok) throw new Error(`AniList failed: HTTP ${res.status}`);
  const json = await res.json();
  if (json.errors) throw new Error(`AniList error: ${json.errors[0]?.message}`);
  return json.data;
}

const MEDIA = `id title { english romaji } format countryOfOrigin status averageScore genres siteUrl coverImage { medium } description(asHtml: false)`;

const myShelf = deskTool("my_shelf", "List the series the reader tracks, with their notes.", z.object({}), async () =>
  db.prepare("SELECT title, source, notes, last_chapter FROM series").all(),
);

const anilistSearch = deskTool(
  "anilist_search",
  "Search AniList for manga/manhwa/webtoons by title or by genres/tags. Returns id, title, format, country (JP manga, KR manhwa/webtoon, CN manhua), score, genres.",
  z.object({ search: z.string().optional(), genres: z.array(z.string()).optional(), sort: z.enum(["POPULARITY_DESC", "SCORE_DESC", "TRENDING_DESC"]).optional() }),
  async ({ search, genres, sort }) => {
    const data = await anilist(
      `query($search:String,$genres:[String],$sort:[MediaSort]){Page(perPage:10){media(type:MANGA,search:$search,genre_in:$genres,sort:$sort,isAdult:false){${MEDIA}}}}`,
      { search, genres, sort: [sort ?? (search ? "SEARCH_MATCH" : "TRENDING_DESC")] },
    );
    return data.Page.media.map((m: { description?: string }) => ({ ...m, description: m.description?.replace(/<[^>]+>/g, "").slice(0, 300) }));
  },
);

const anilistRecs = deskTool(
  "anilist_recommendations",
  "Get community recommendations for a given AniList media id.",
  z.object({ id: z.number().int() }),
  async ({ id }) => {
    const data = await anilist(`query($id:Int){Media(id:$id){recommendations(perPage:10,sort:RATING_DESC){nodes{rating mediaRecommendation{${MEDIA}}}}}}`, { id });
    return data.Media.recommendations.nodes.map((n: { rating: number; mediaRecommendation: { description?: string } }) => ({
      rating: n.rating,
      ...n.mediaRecommendation,
      description: n.mediaRecommendation?.description?.replace(/<[^>]+>/g, "").slice(0, 250),
    }));
  },
);

const RecsSchema = z.array(z.object({ title: z.string(), format: z.string(), reason: z.string(), url: z.string(), cover: z.string().nullable().optional() })).min(1).max(6);

export async function recommend() {
  const already = (db.prepare("SELECT title FROM recommendations WHERE date > date('now', '-60 days')").all() as { title: string }[]).map((r) => r.title);
  const { text } = await runAgent({
    agent: "shelf.recommender",
    maxSteps: 8,
    tools: { my_shelf: myShelf, anilist_search: anilistSearch, anilist_recommendations: anilistRecs },
    instructions: `You recommend manga, manhwa and webtoons to one reader.\n${PROFILE}\nCheck my_shelf first. For tracked series, find them on AniList and pull community recommendations; if the shelf is empty, explore trending and high-scoring titles across genres the reader would like (history, strategy, mature seinen, well-crafted fantasy, slice-of-life). Mix formats and countries. Don't repeat: ${already.slice(0, 40).join("; ") || "(none yet)"}.\nReturn ONLY JSON: [{"title","format":"Manga|Manhwa|Webtoon|Manhua","reason":"one specific sentence tied to their taste","url": AniList siteUrl,"cover": coverImage.medium}] with 4 items.`,
    prompt: `Today is ${localDate()}. Recommend.`,
  });
  const recs = parseJson(text, RecsSchema);
  const ins = db.prepare("INSERT INTO recommendations(date, title, format, reason, url, cover) VALUES (?,?,?,?,?,?)");
  for (const r of recs) ins.run(localDate(), r.title, r.format, r.reason, r.url, r.cover ?? null);
  return { recommendations: recs.length };
}
