import Link from "next/link";
import { AskContext } from "@/components/AskPanel";
import { Markdown } from "@/components/Markdown";
import { RunButton } from "@/components/RunButton";
import { Time } from "@/components/Time";
import { config, formatYear, localDate } from "@/lib/config";
import { listConversations } from "@/lib/conversations";
import { db, kvGet } from "@/lib/db";
import { spentToday } from "@/lib/llm";

export const dynamic = "force-dynamic";

export default function Today() {
  const brief = db.prepare("SELECT * FROM briefs ORDER BY created_at DESC LIMIT 1").get() as
    | { date: string; edition: string; headline: string; markdown: string; created_at: string }
    | undefined;
  const card = db.prepare("SELECT * FROM history_cards ORDER BY date DESC LIMIT 1").get() as { date: string; year: number; markdown: string } | undefined;
  const due = (db.prepare("SELECT COUNT(*) AS n FROM quiz_items WHERE due <= ?").get(localDate()) as { n: number }).n;
  const updates = db
    .prepare(
      "SELECT s.id, s.title, s.cover, COUNT(c.id) AS n, MAX(c.label) AS latest FROM chapters c JOIN series s ON s.id = c.series_id WHERE c.seen = 0 GROUP BY s.id ORDER BY MAX(c.found_at) DESC LIMIT 5",
    )
    .all() as { id: number; title: string; cover: string | null; n: number; latest: string }[];
  const faqs = listConversations(30).filter((c) => c.source === "reader").slice(0, 3);
  const spent = spentToday();
  const pct = Math.min(100, (spent / config.dailyBudgetUsd) * 100);
  const lastWake = kvGet("last_wake");

  const body = brief?.markdown.replace(/^#\s+.+\n+/, "") ?? "";
  const cardTitle = card?.markdown.match(/^#\s+(.+)$/m)?.[1];
  const cardHook = card?.markdown.match(/^_(.+)_$/m)?.[1];

  return (
    <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_300px]">
      <AskContext
        label={brief ? `${brief.edition === "morning" ? "Morning brief" : "Evening wrap"}: ${brief.headline}` : "Today"}
        suggestions={[
          "What's the one thing I should take away from this?",
          "Explain the mechanism behind the biggest story here",
          "What would change your read on this?",
        ]}
      />
      <article>
        {brief ? (
          <>
            <div className="kicker mb-3">
              {brief.edition === "morning" ? "Morning brief" : "Evening wrap"} · <Time utc={brief.created_at} mode="datetime" />
            </div>
            <h1 className="font-serif text-4xl sm:text-[3.4rem] leading-[1.05] tracking-tight mb-6">{brief.headline}</h1>
            <Markdown className="prose-lg font-serif prose-p:leading-relaxed prose-h2:text-2xl prose-h2:mt-10 prose-h2:border-t prose-h2:border-rule prose-h2:pt-6">{body}</Markdown>
          </>
        ) : (
          <div className="card p-10 text-center">
            <div className="kicker mb-3">No brief yet</div>
            <p className="font-serif text-2xl mb-6">The first edition hasn&apos;t been written.</p>
            <RunButton job="wire.morning" label="Write the morning brief now" className="btn btn-accent" />
            <p className="text-sm text-muted mt-4">Takes 1–3 minutes: fetch feeds → triage → editor agent.</p>
          </div>
        )}
      </article>

      <aside className="space-y-8 lg:border-l lg:border-rule lg:pl-8">
        <section>
          <div className="kicker mb-2">Meanwhile…</div>
          {card ? (
            <Link href="/history" className="group block">
              <div className="font-mono text-xs text-accent mb-1">{formatYear(card.year)}</div>
              <div className="font-serif text-xl leading-snug group-hover:underline decoration-1 underline-offset-4">{cardTitle}</div>
              {cardHook && <p className="text-sm text-muted mt-2 italic font-serif">{cardHook}</p>}
            </Link>
          ) : (
            <RunButton job="history.card" label="Write today's card" />
          )}
          {due > 0 && (
            <Link href="/history#quiz" className="mt-3 inline-block text-sm text-accent hover:underline">
              {due} quiz question{due === 1 ? "" : "s"} due →
            </Link>
          )}
        </section>

        <section>
          <div className="kicker mb-2">The reader asked</div>
          {faqs.length ? (
            <ul className="space-y-2">
              {faqs.map((f) => (
                <li key={f.id}>
                  <Link href={`/ask/${f.id}`} className="font-serif text-[1.05rem] leading-snug hover:underline decoration-1 underline-offset-4">
                    {f.title}
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted">Follow-up questions appear after the morning brief.</p>
          )}
        </section>

        <section>
          <div className="kicker mb-2">On your shelf</div>
          {updates.length ? (
            <ul className="space-y-2">
              {updates.map((u) => (
                <li key={u.id} className="flex items-baseline justify-between gap-3 text-sm">
                  <Link href="/shelf" className="truncate hover:underline">{u.title}</Link>
                  <span className="chip shrink-0">{u.n} new</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted">
              Nothing new. <Link href="/shelf" className="underline">Track a series</Link>
            </p>
          )}
        </section>

        <section>
          <div className="kicker mb-2">Desk pulse</div>
          <div className="flex justify-between text-sm mb-1.5">
            <span>Spent today</span>
            <span className="font-mono">${spent.toFixed(2)} / ${config.dailyBudgetUsd}</span>
          </div>
          <div className="h-1.5 rounded-full bg-paper-2 overflow-hidden">
            <div className={`h-full ${pct > 80 ? "bg-bad" : "bg-ink"}`} style={{ width: `${pct}%` }} />
          </div>
          {lastWake && (
            <p className="text-xs text-muted mt-2">
              Last woke <Time utc={lastWake} mode="relative" /> and caught up.
            </p>
          )}
          <Link href="/system" className="text-xs text-muted hover:text-ink mt-2 inline-block">Jobs & runs →</Link>
        </section>
      </aside>
    </div>
  );
}
