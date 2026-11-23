import Link from "next/link";
import { AskContext, OpenAsk } from "@/components/AskPanel";
import { Markdown } from "@/components/Markdown";
import { Quiz } from "@/components/Quiz";
import { RunButton } from "@/components/RunButton";
import { Time } from "@/components/Time";
import { formatYear, localDate } from "@/lib/config";
import { listConversations } from "@/lib/conversations";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

function sections(md: string) {
  const title = md.match(/^#\s+(.+)$/m)?.[1] ?? "";
  const hook = md.match(/^_(.+)_$/m)?.[1] ?? "";
  const out: Record<string, string> = {};
  for (const block of md.split(/^##\s+/m).slice(1)) {
    const [head, ...rest] = block.split("\n");
    out[head.trim().toLowerCase()] = rest.join("\n").trim();
  }
  return { title, hook, out };
}

export default async function History({ searchParams }: { searchParams: Promise<{ d?: string }> }) {
  const { d } = await searchParams;
  const card = (d
    ? db.prepare("SELECT * FROM history_cards WHERE date = ?").get(d)
    : db.prepare("SELECT * FROM history_cards ORDER BY date DESC LIMIT 1").get()) as { date: string; year: number; markdown: string; created_at: string } | undefined;
  const past = db.prepare("SELECT date, year, substr(markdown, 1, 160) AS head FROM history_cards ORDER BY date DESC LIMIT 30").all() as { date: string; year: number; head: string }[];
  const due = (db.prepare("SELECT * FROM quiz_items WHERE due <= ? ORDER BY due, id LIMIT 12").all(localDate()) as { id: number; question: string; choices: string; explanation: string | null; box: number }[]).map(
    (q) => ({ ...q, choices: JSON.parse(q.choices) as string[] }),
  );
  const threads = listConversations(100).filter((c) => c.agent === "tutor").slice(0, 8);
  const s = card ? sections(card.markdown) : null;
  const panel = (key: string, label: string) =>
    s?.out[key] ? (
      <div>
        <div className="kicker mb-2 text-accent">{label}</div>
        <Markdown className="font-serif prose-p:leading-relaxed">{s.out[key]}</Markdown>
      </div>
    ) : null;

  return (
    <div className="space-y-14">
      <AskContext
        agent="tutor"
        label={card ? `Meanwhile… ${formatYear(card.year)}` : "History"}
        suggestions={[
          "How do we actually know any of this?",
          "What happened next, in both places?",
          "What would a day in the life have looked like here?",
        ]}
      />
      {card && s ? (
        <section>
          <div className="kicker mb-2">
            Meanwhile… · {formatYear(card.year)} · <Time utc={card.created_at} mode="datetime" />
          </div>
          <h1 className="font-serif text-4xl sm:text-5xl tracking-tight leading-[1.05] mb-3">{s.title}</h1>
          {s.hook && <p className="font-serif italic text-xl text-ink-2 mb-8">{s.hook}</p>}
          <div className="grid gap-10 md:grid-cols-2 border-t border-rule pt-8">
            {panel("india", "India")}
            {panel("europe", "Europe")}
          </div>
          <div className="grid gap-10 md:grid-cols-2 border-t border-rule pt-8 mt-8">
            {panel("elsewhere", "Elsewhere")}
            {panel("the thread", "The thread")}
          </div>
        </section>
      ) : (
        <div className="card p-10 text-center">
          <p className="font-serif text-2xl mb-5">No card yet today.</p>
          <RunButton job="history.card" label="Write today's card" className="btn btn-accent" />
        </div>
      )}

      <div className="grid gap-12 lg:grid-cols-2">
        <section id="quiz">
          <h2 className="font-serif text-2xl mb-4">Spaced repetition</h2>
          <Quiz items={due} />
        </section>
        <section>
          <h2 className="font-serif text-2xl mb-4">Ask the tutor</h2>
          <p className="text-sm text-muted mb-3">Highlight anything on the card to ask about it, or open the panel.</p>
          <OpenAsk className="btn btn-accent mb-6">Ask the tutor about this card</OpenAsk>
          <ul className="divide-y divide-rule border-y border-rule">
            {threads.map((t) => (
              <li key={t.id}>
                <Link href={`/ask/${t.id}`} className="flex justify-between gap-3 py-2.5 group">
                  <span className="font-serif group-hover:underline underline-offset-4 decoration-1">{t.title}</span>
                  <span className="chip shrink-0">{t.source === "student" ? "student" : "you"}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      </div>

      {past.length > 1 && (
        <section>
          <h2 className="kicker mb-3">Past cards</h2>
          <div className="flex flex-wrap gap-2">
            {past.map((p) => (
              <Link key={p.date} href={`/history?d=${p.date}`} className={`chip !normal-case !text-xs ${p.date === card?.date ? "!text-ink !border-ink" : ""}`}>
                {formatYear(p.year)} · {p.date.slice(5)}
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
