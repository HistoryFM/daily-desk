"use client";
import { coverSrc } from "@/lib/cover";
import { useState, useTransition } from "react";
import { searchManga, trackManga } from "@/app/actions";

type Result = Awaited<ReturnType<typeof searchManga>>[number];

export function MangaSearch() {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Result[]>([]);
  const [added, setAdded] = useState<Set<string>>(new Set());
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <div>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setErr(null);
          start(async () => {
            try {
              setResults(await searchManga(q));
            } catch (e) {
              setErr(e instanceof Error ? e.message : "Search failed");
            }
          });
        }}
      >
        <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search MangaDex — e.g. Vinland Saga" />
        <button className="btn btn-accent" disabled={pending}>{pending ? "…" : "Search"}</button>
      </form>
      {err && <p className="text-sm text-bad mt-2">{err}</p>}
      {results.length > 0 && (
        <ul className="mt-3 divide-y divide-rule border-y border-rule">
          {results.map((r) => (
            <li key={r.id} className="flex items-center gap-3 py-2">
              {r.cover ? <img src={coverSrc(r.cover)} alt="" className="w-9 h-12 object-cover rounded-sm" /> : <div className="w-9 h-12 bg-paper-2 rounded-sm" />}
              <div className="min-w-0 flex-1">
                <div className="truncate">{r.title}</div>
                <div className="text-xs text-muted truncate">
                  {[r.year, r.status, ...r.tags.slice(0, 3)].filter(Boolean).join(" · ")}
                </div>
              </div>
              <button
                className="btn text-xs"
                disabled={added.has(r.id)}
                onClick={() =>
                  start(async () => {
                    await trackManga({ id: r.id, title: r.title, url: r.url, cover: r.cover });
                    setAdded(new Set(added).add(r.id));
                  })
                }
              >
                {added.has(r.id) ? "Tracking" : "Track"}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
