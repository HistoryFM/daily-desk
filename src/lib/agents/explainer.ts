import { z } from "zod";
import { config } from "../config";
import { createConversation, getConversation, saveMessages, textMessage, toModelMessages } from "../conversations";
import { parseJson, runAgent } from "../llm";
import { PROFILE } from "../profile";
import { searchNews } from "../tools/news";
import { fetchUrl, hnSearch, webSearch } from "../tools/web";
import { wikipediaPage, wikipediaSearch } from "../tools/wikipedia";
import { latestBrief } from "./wire";

export const explainerTools = {
  web_search: webSearch,
  fetch_url: fetchUrl,
  wikipedia_search: wikipediaSearch,
  wikipedia_page: wikipediaPage,
  hn_search: hnSearch,
  search_news: searchNews,
};

export function explainerInstructions(context?: string | null) {
  return `You are the Explainer: a sharp, patient expert who explains how things actually work — technology, business models, markets, policy, science.

Reader profile:
${PROFILE}

How to answer:
- Lead with the direct answer in 1-2 sentences, then build the mechanism step by step.
- Prefer concrete numbers, examples, and analogies over abstractions. Name the incentives.
- Use tools when facts may be recent or you are unsure: web_search → fetch_url to read, wikipedia for background, hn_search for practitioner views, search_news for what the desk has collected. Don't call tools for things you know well.
- Cite sources inline as [short name](url) when you used them.
- Markdown. Use a small table or numbered steps when it clarifies. Keep it under ~400 words unless asked for depth.
- End with one line: "**Go deeper:** " + a follow-up question worth asking.${context ? `\n\nThis conversation started from this context:\n${context}` : ""}`;
}

/** Runs one explainer turn on a stored conversation (used by automated agents). */
export async function explainerTurn(conversationId: string, question: string, by: string, modelId = config.modelFast) {
  const convo = getConversation(conversationId);
  if (!convo) throw new Error(`Conversation ${conversationId} not found`);
  const messages = [...convo.messages, textMessage("user", question, { by })];
  const { text, steps } = await runAgent({
    agent: "explainer",
    modelId,
    maxSteps: 6,
    conversationId,
    tools: explainerTools,
    instructions: explainerInstructions(convo.context),
    messages: toModelMessages(messages),
  });
  const tools = steps.flatMap((s) => (s.toolCalls ?? []).map((c) => c.toolName));
  messages.push(textMessage("assistant", text, { tools }));
  saveMessages(conversationId, messages);
  return text;
}

const QuestionsSchema = z.array(z.object({ title: z.string(), question: z.string() })).min(1).max(4);

/**
 * The curious reader: reads the latest brief, asks the explainer questions,
 * then asks a follow-up based on each answer — producing real multi-turn conversations daily.
 */
export async function curiousReader(count = 3) {
  const brief = latestBrief();
  if (!brief) throw new Error("Curious reader has no brief to read yet");
  const { text } = await runAgent({
    agent: "reader.questions",
    instructions: `You are a curious, well-read reader. ${PROFILE}\nAfter reading today's brief, pick ${count} things you'd genuinely want explained — "how does X actually work", "why would Y do that", "what happens next if Z". Avoid trivia. Return ONLY JSON: [{"title": "3-6 word topic", "question": "the question as you'd ask it"}]`,
    prompt: brief.markdown,
  });
  const questions = parseJson(text, QuestionsSchema).slice(0, count);
  const ids: string[] = [];
  for (const q of questions) {
    const id = createConversation({ agent: "explainer", source: "reader", title: q.title, context: `From the ${brief.edition} brief of ${brief.date}: "${brief.headline}"` });
    ids.push(id);
    const answer = await explainerTurn(id, q.question, "reader");
    const follow = await runAgent({
      agent: "reader.followup",
      instructions: `You are a curious reader in a conversation with an expert. ${PROFILE}\nAsk ONE natural follow-up question (1-2 sentences) that digs into the most interesting or least convincing part of the answer. Output only the question.`,
      prompt: `You asked: ${q.question}\n\nThey answered:\n${answer}`,
      conversationId: id,
    });
    await explainerTurn(id, follow.text.trim(), "reader");
  }
  return { conversations: ids.length };
}
