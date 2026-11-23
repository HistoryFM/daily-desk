import { createUIMessageStreamResponse, isStepCount, streamText, toUIMessageStream } from "ai";
import { explainerInstructions, explainerTools } from "@/lib/agents/explainer";
import { historyTools, tutorInstructions } from "@/lib/agents/history";
import { config } from "@/lib/config";
import { createConversation, getConversation, saveMessages, toModelMessages, type StoredMessage } from "@/lib/conversations";
import { assertBudget, BudgetExceededError, model, recordUsage } from "@/lib/llm";
import { buildPageContext, type PageFocus } from "@/lib/pageContext";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f-]{36}$/i;

/** Title for a new thread: the question itself, without any quoted passage. */
function titleFrom(messages: StoredMessage[]) {
  const text = messages.find((m) => m.role === "user")?.parts.map((p) => p.text ?? "").join(" ") ?? "";
  const question = text
    .split("\n")
    .filter((l) => !l.startsWith(">"))
    .join(" ")
    .trim();
  return (question || text.replace(/^>\s?/gm, "")).slice(0, 80) || "Untitled";
}

/** Loads a thread so the ask panel can restore it after a reload. */
export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("id") ?? "";
  const convo = getConversation(id);
  if (!convo) return Response.json({ messages: [] }, { status: 404 });
  return Response.json({ id: convo.id, agent: convo.agent, title: convo.title, messages: convo.messages });
}

export async function POST(req: Request) {
  const { id, messages, page, focus } = (await req.json()) as { id: string; messages: StoredMessage[]; page?: string; focus?: PageFocus };
  let convo = getConversation(id);
  if (!convo) {
    // The ask panel starts threads lazily: the first message creates it, with the page as context.
    if (!UUID.test(id) || !page) return new Response("Conversation not found", { status: 404 });
    const ctx = buildPageContext(page, focus);
    createConversation({
      id,
      agent: ctx.agent,
      source: focus?.article ? "dig-in" : "you",
      title: (ctx.title ?? titleFrom(messages)).slice(0, 80),
      context: `The reader opened this conversation from the "${ctx.label}" page of their desk (${page}). When a message starts with a quoted passage (lines beginning with ">"), the reader highlighted that passage on the page and is asking about it. Ground answers in the page, but go beyond it with tools when it's thin or may be out of date.\n\nThe page shows:\n\n${ctx.context}`,
    });
    convo = getConversation(id)!;
  }

  try {
    assertBudget();
  } catch (err) {
    if (err instanceof BudgetExceededError) return new Response(err.message, { status: 429 });
    throw err;
  }

  const isTutor = convo.agent === "tutor";
  const agent = isTutor ? "history.tutor" : "explainer";
  const modelId = config.modelSmart;

  const result = streamText({
    model: model(modelId),
    instructions: isTutor ? tutorInstructions(convo.context) : explainerInstructions(convo.context),
    messages: toModelMessages(messages),
    tools: isTutor ? historyTools : explainerTools,
    stopWhen: isStepCount(8),
    telemetry: { functionId: agent },
    onEnd: async ({ usage, steps }) => {
      await recordUsage(agent, modelId, { usage, steps } as never);
    },
    onError: ({ error }) => {
      console.error(`[desk] ${agent} chat failed:`, error);
    },
  });

  return createUIMessageStreamResponse({
    stream: toUIMessageStream({
      stream: result.stream,
      originalMessages: messages as never,
      onEnd: ({ messages: all }) => {
        saveMessages(id, all as unknown as StoredMessage[]);
      },
    }),
  });
}
