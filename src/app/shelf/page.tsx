import { coverSrc } from "@/lib/cover";
import { addWebtoon, markSeen, untrack } from "@/app/actions";
import { AskContext } from "@/components/AskPanel";
import { MangaSearch } from "@/components/MangaSearch";
import { RunButton } from "@/components/RunButton";
import { Time } from "@/components/Time";
import type { SeriesRow } from "@/lib/agents/manga";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export default function Shelf() {
  const series = db
    .prepare("SELECT s.*, (SELECT COUNT(*) FROM chapters c WHERE c.series_id = s.id AND c.seen = 0) AS unseen FROM series s ORDER BY unseen DESC, s.title")
    .all() as (SeriesRow & { unseen: number })[];
  const fresh = db
    .prepare("SELECT c.*, s.title AS series FROM chapters c JOIN series s ON s.id = c.series_id WHERE c.seen = 0 ORDER BY c.published_at DESC LIMIT 30")
    .all() as { id: number; series_id: number; label: string; url: string; published_at: string | null; series: string }[];
  const recs = db.prepare("SELECT * FROM recommendations WHERE dismissed = 0 ORDER BY id DESC LIMIT 8").all() as {
    id: number;
    date: string;
    title: string;
    format: string;
    reason: string;
    url: string;
    cover: string | null;
  }[];

  return (
    <div className="space-y-14">
      <AskContext
        label="Your shelf"
        suggestions={["Why did the desk recommend these?", "Give me something like what I'm reading, but stranger", "Which of these should I read first, and why?"]}
      />
      <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_340px]">
        <section>
          <div className="flex items-baseline justify-between mb-4">
            <h1 className="font-serif text-4xl">Your shelf</h1>
            <RunButton job="shelf.check" label="Check now" />
          </div>
          {series.length === 0 ? (
            <p className="text-muted">Track a series on the right — the desk checks for new chapters every 6 hours.</p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-5">
              {series.map((s) => (
                <div key={s.id} className="group">
                  <a href={s.url ?? "#"} target="_blank" rel="noreferrer" className="block relative aspect-[2/3] bg-paper-2 rounded overflow-hidden border border-rule">
                    {s.cover ? (
                      <img src={coverSrc(s.cover)} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <div className="p-3 font-serif text-lg leading-tight">{s.title}</div>
                    )}
                    {s.unseen > 0 && <span className="absolute top-2 right-2 bg-accent text-paper text-[0.65rem] font-mono px-1.5 py-0.5 rounded">{s.unseen} NEW</span>}
                  </a>
                  <div className="mt-2 text-sm leading-snug line-clamp-2">{s.title}</div>
                  <div className="text-xs text-muted flex justify-between items-center mt-0.5">
                    <span>{s.last_chapter ? `Latest: ${s.last_chapter.length > 18 ? s.last_chapter.slice(0, 18) + "…" : s.last_chapter}` : s.source}</span>
                    <form action={untrack.bind(null, s.id)}>
                      <button className="opacity-0 group-hover:opacity-100 hover:text-bad transition-opacity" title="Stop tracking">✕</button>
                    </form>
                  </div>
                </div>
              ))}
            </div>
          )}

          {fresh.length > 0 && (
            <div className="mt-10">
              <h2 className="kicker mb-3">New chapters</h2>
              <ul className="divide-y divide-rule border-y border-rule">
                {fresh.map((c) => (
                  <li key={c.id} className="flex items-baseline justify-between gap-3 py-2.5 text-sm">
                    <a href={c.url} target="_blank" rel="noreferrer" className="hover:underline min-w-0 truncate">
                      <span className="font-medium">{c.series}</span> <span className="text-muted">— {c.label}</span>
                    </a>
                    <span className="flex items-center gap-3 shrink-0 text-xs text-muted">
                      <Time utc={c.published_at} mode="relative" />
                      <form action={markSeen.bind(null, c.series_id)}>
                        <button className="hover:text-ink">mark read</button>
                      </form>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>

        <aside className="space-y-8">
          <div>
            <div className="kicker mb-2">Track manga</div>
            <MangaSearch />
          </div>
          <div>
            <div className="kicker mb-2">Track a webtoon</div>
            <form action={addWebtoon} className="flex gap-2">
              <input name="url" className="input text-sm" placeholder="https://www.webtoons.com/en/…/list?title_no=…" />
              <button className="btn">Add</button>
            </form>
          </div>
        </aside>
      </div>

      <section>
        <div className="flex items-baseline justify-between mb-4">
          <h2 className="font-serif text-3xl">The desk recommends</h2>
          <RunButton job="shelf.recs" label="New picks" />
        </div>
        {recs.length === 0 ? (
          <p className="text-muted">Recommendations arrive each evening.</p>
        ) : (
          <div className="grid gap-6 sm:grid-cols-2">
            {recs.map((r) => (
              <a key={r.id} href={r.url} target="_blank" rel="noreferrer" className="card flex gap-4 p-4 hover:bg-paper-2 transition-colors">
                {r.cover ? <img src={coverSrc(r.cover)} alt="" className="w-16 h-24 object-cover rounded-sm shrink-0" /> : <div className="w-16 h-24 bg-paper-2 rounded-sm shrink-0" />}
                <div className="min-w-0">
                  <div className="kicker">{r.format}</div>
                  <div className="font-serif text-lg leading-snug">{r.title}</div>
                  <p className="text-sm text-ink-2 mt-1">{r.reason}</p>
                </div>
              </a>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
