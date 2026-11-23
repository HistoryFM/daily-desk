import Link from "next/link";
import { AskButton, AskContext } from "@/components/AskPanel";
import { Markdown } from "@/components/Markdown";
import { RunButton } from "@/components/RunButton";
import { Time } from "@/components/Time";
import { db } from "@/lib/db";
import type { ArticleRow } from "@/lib/tools/news";

export const dynamic = "force-dynamic";

export default async function Wire({ searchParams }: { searchParams: Promise<{ b?: string; tab?: string }> }) {
  const { b, tab } = await searchParams;
  const briefs = db.prepare("SELECT id, date, edition, headline, created_at FROM briefs ORDER BY created_at DESC LIMIT 30").all() as {
    id: number;
    date: string;
    edition: string;
    headline: string;
    created_at: string;
  }[];
  const selected = b ? (db.prepare("SELECT * FROM briefs WHERE id = ?").get(Number(b)) as { headline: string; markdown: string; created_at: string; edition: string } | undefined) : undefined;
  const showPile = tab === "pile" || (!selected && !b);
  const pile = db
    .prepare("SELECT * FROM articles WHERE fetched_at > datetime('now', '-36 hours') ORDER BY (score IS NULL), score DESC, fetched_at DESC LIMIT 80")
    .all() as ArticleRow[];

  return (
    <div className="grid gap-10 lg:grid-cols-[240px_minmax(0,1fr)]">
      {selected && !showPile ? (
        <AskContext
          label={`${selected.edition === "morning" ? "Morning brief" : "Evening wrap"}: ${selected.headline}`}
          suggestions={["What's the one thing I should take away from this?", "Explain the jargon in this edition", "What did this edition get wrong or leave out?"]}
        />
      ) : (
        <AskContext label="The pile" suggestions={["What are the 3 stories here that actually matter?", "Which of these are the same story told twice?", "What's the theme running through today's pile?"]} />
      )}
      <aside>
        <div className="flex items-center justify-between mb-3">
          <div className="kicker">Editions</div>
        </div>
        <Link href="/wire?tab=pile" className={`block text-sm py-1.5 ${showPile ? "text-ink font-medium" : "text-muted hover:text-ink"}`}>
          The pile <span className="text-muted font-normal">· {pile.length}</span>
        </Link>
        <ul className="mt-2 border-t border-rule">
          {briefs.map((x) => (
            <li key={x.id} className="border-b border-rule">
              <Link href={`/wire?b=${x.id}`} className={`block py-2.5 ${String(x.id) === b ? "text-ink" : "text-ink-2 hover:text-ink"}`}>
                <div className="kicker">
                  {x.date} · {x.edition}
                </div>
                <div className="font-serif leading-snug mt-0.5">{x.headline}</div>
              </Link>
            </li>
          ))}
        </ul>
        <div className="mt-5 flex flex-col gap-2 items-start">
          <RunButton job="wire.refresh" label="Fetch & triage now" />
          <RunButton job="wire.evening" label="Write evening wrap" />
        </div>
      </aside>

      <section>
        {selected && !showPile ? (
          <>
            <div className="kicker mb-3">
              {selected.edition} · <Time utc={selected.created_at} mode="datetime" />
            </div>
            <Markdown className="prose-lg font-serif prose-h1:text-4xl prose-h2:border-t prose-h2:border-rule prose-h2:pt-6">{selected.markdown}</Markdown>
          </>
        ) : (
          <>
            <h1 className="font-serif text-3xl mb-1">The pile</h1>
            <p className="text-sm text-muted mb-6">Everything the triage agent read in the last 36 hours, ranked for you. Dig in to have the explainer walk you through a story.</p>
            <ol className="divide-y divide-rule border-y border-rule">
              {pile.map((a) => (
                <li key={a.id} className="py-4 grid grid-cols-[2.5rem_minmax(0,1fr)_auto] gap-3 items-start">
                  <div className={`font-mono text-sm pt-0.5 ${a.score != null && a.score >= 7 ? "text-accent" : "text-muted"}`}>{a.score != null ? a.score.toFixed(0) : "–"}</div>
                  <div className="min-w-0">
                    <a href={a.url} target="_blank" rel="noreferrer" className="font-serif text-lg leading-snug hover:underline decoration-1 underline-offset-4">
                      {a.title}
                    </a>
                    {a.one_line && <p className="text-sm text-ink-2 mt-1">{a.one_line}</p>}
                    <div className="flex flex-wrap gap-1.5 mt-2 items-center">
                      <span className="kicker mr-1">{a.source}</span>
                      {a.tags?.split(",").filter(Boolean).map((t) => (
                        <span key={t} className="chip">{t}</span>
                      ))}
                    </div>
                  </div>
                  <AskButton
                    focus={{ article: a.id }}
                    label={a.title}
                    prompt="Explain this story to me: what actually happened, how the underlying thing works, and why it matters."
                  >
                    Dig in
                  </AskButton>
                </li>
              ))}
            </ol>
            {pile.length === 0 && <p className="text-muted mt-6">Nothing fetched yet. Hit “Fetch & triage now”.</p>}
          </>
        )}
      </section>
    </div>
  );
}
