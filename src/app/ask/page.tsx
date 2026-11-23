import Link from "next/link";
import { OpenAsk } from "@/components/AskPanel";
import { Time } from "@/components/Time";
import { listConversations } from "@/lib/conversations";

export const dynamic = "force-dynamic";

const SOURCE_LABEL: Record<string, string> = { you: "You", reader: "Reader", student: "Student", "dig-in": "Dig-in" };

export default async function Ask({ searchParams }: { searchParams: Promise<{ f?: string }> }) {
  const { f } = await searchParams;
  const all = listConversations(200);
  const list = f ? all.filter((c) => c.source === f || c.agent === f) : all;
  const filters = ["you", "dig-in", "reader", "tutor", "student"];
  return (
    <div className="max-w-3xl">
      <div className="flex items-end justify-between gap-4 mb-8">
        <div>
          <h1 className="font-serif text-4xl mb-2">Threads</h1>
          <p className="text-muted">Everything you and the agents have asked. Press ⌘K on any page to ask about it.</p>
        </div>
        <OpenAsk className="btn btn-accent shrink-0">Ask</OpenAsk>
      </div>

      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <span className="kicker mr-2">Threads</span>
        <Link href="/ask" className={`chip ${!f ? "!text-ink !border-ink" : ""}`}>all</Link>
        {filters.map((x) => (
          <Link key={x} href={`/ask?f=${x}`} className={`chip ${f === x ? "!text-ink !border-ink" : ""}`}>{x}</Link>
        ))}
      </div>
      <ul className="divide-y divide-rule border-y border-rule">
        {list.map((c) => (
          <li key={c.id}>
            <Link href={`/ask/${c.id}`} className="flex items-baseline justify-between gap-4 py-3 group">
              <span className="font-serif text-lg leading-snug group-hover:underline decoration-1 underline-offset-4">{c.title}</span>
              <span className="shrink-0 flex items-center gap-2 text-xs text-muted">
                <span className="chip">{c.agent === "tutor" ? "tutor" : SOURCE_LABEL[c.source]}</span>
                <Time utc={c.updated_at} mode="relative" />
              </span>
            </Link>
          </li>
        ))}
        {list.length === 0 && <li className="py-6 text-muted">No threads yet.</li>}
      </ul>
    </div>
  );
}
