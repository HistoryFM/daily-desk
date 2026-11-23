import type { UIMessage } from "ai";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AskContext } from "@/components/AskPanel";
import { Chat } from "@/components/Chat";
import { getConversation } from "@/lib/conversations";

export const dynamic = "force-dynamic";

export default async function Thread({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ q?: string }> }) {
  const { id } = await params;
  const { q } = await searchParams;
  const convo = getConversation(id);
  if (!convo) notFound();
  return (
    <div className="max-w-3xl">
      <AskContext
        agent={convo.agent === "tutor" ? "tutor" : "explainer"}
        label={`Thread: ${convo.title}`}
        suggestions={["Steelman the opposite view", "Summarise this thread in three bullets", "What's the best primary source to read on this?"]}
      />
      <Link href="/ask" className="kicker hover:text-ink">← All threads</Link>
      <h1 className="font-serif text-3xl sm:text-4xl leading-tight mt-3 mb-2">{convo.title}</h1>
      {convo.context && <p className="text-sm text-muted mb-6 whitespace-pre-line line-clamp-3">{convo.context}</p>}
      <Chat id={id} agent={convo.agent} initial={convo.messages as unknown as UIMessage[]} autoAsk={convo.messages.length === 0 ? q : undefined} />
    </div>
  );
}
