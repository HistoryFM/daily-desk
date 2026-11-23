import { z } from "zod";
import { config, formatYear, localDate } from "../config";
import { createConversation, textMessage, getConversation, saveMessages, toModelMessages } from "../conversations";
import { db } from "../db";
import { deskTool, parseJson, runAgent } from "../llm";
import { PROFILE } from "../profile";
import { lookup, TIMELINE } from "../timeline";
import { wikipediaPage, wikipediaSearch } from "../tools/wikipedia";

export const timelineTool = deskTool(
  "timeline_lookup",
  "Look up the desk's backbone timeline of events/dynasties between two years (negative = BC). Optional region: India, Europe, Near East, East Asia.",
  z.object({ from: z.number().int(), to: z.number().int(), region: z.enum(["India", "Europe", "Near East", "East Asia"]).optional() }),
  async ({ from, to, region }) => lookup(from, to, region).map((e) => ({ ...e, when: e.end ? `${formatYear(e.start)}–${formatYear(e.end)}` : formatYear(e.start) })),
);

export const historyTools = { timeline_lookup: timelineTool, wikipedia_search: wikipediaSearch, wikipedia_page: wikipediaPage };

function pickYear(date: string): number {
  const used = new Set((db.prepare("SELECT year FROM history_cards WHERE date > date(?, '-120 days')").all(date) as { year: number }[]).map((r) => r.year));
  const anchors = TIMELINE.filter((e) => (e.region === "India" || e.region === "Europe") && e.start >= -3000 && e.start <= 1100);
  let seed = [...date].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
  for (let i = 0; i < 50; i++) {
    seed = (seed * 1103515245 + 12345) >>> 0;
    const a = anchors[seed % anchors.length];
    const span = a.end ? a.end - a.start : 0;
    const year = Math.round((a.start + ((seed >> 8) % (span + 1))) / 5) * 5 || 5;
    if (!used.has(year)) return year;
  }
  return anchors[seed % anchors.length].start;
}

/** Multi-step agent: writes the daily "Meanwhile…" card comparing India and Europe in one year. */
export async function writeMeanwhileCard(date = localDate()) {
  const year = pickYear(date);
  const { text } = await runAgent({
    agent: "history.meanwhile",
    modelId: config.modelSmart,
    maxSteps: 10,
    tools: historyTools,
    instructions: `You write "Meanwhile…", a daily history card for a reader who loves ancient and early-medieval India and Europe.\n${PROFILE}\n\nGiven a year, research with timeline_lookup (±60 years around it, all regions) and 2-4 Wikipedia pages, then write Markdown with EXACTLY these sections:\n# <evocative title naming the year>\n_<one-sentence hook>_\n## India\n## Europe\n## Elsewhere\n## The thread\n\nEach of India/Europe: 120-170 words on who ruled, what ordinary life or ideas looked like, one vivid concrete detail (an object, inscription, text, building). Elsewhere: 60-90 words on the Near East or China. The thread: 60-100 words on a genuine connection or contrast (trade, ideas, climate, empire-building) — no forced parallels. Say "c." for approximate dates, and say plainly when evidence is thin or debated. End with a line "Sources: " listing the Wikipedia pages used as links.`,
    prompt: `Year: ${formatYear(year)} (${year}).`,
  });
  const markdown = text.trim();
  if (!markdown.includes("## India")) throw new Error("Meanwhile card is missing the India section");
  db.prepare("INSERT INTO history_cards(date, year, markdown) VALUES (?,?,?) ON CONFLICT(date) DO UPDATE SET year=excluded.year, markdown=excluded.markdown").run(date, year, markdown);
  await generateQuiz(date, markdown);
  return { year, chars: markdown.length };
}

const QuizSchema = z
  .array(z.object({ question: z.string(), choices: z.array(z.string()).length(4), answer: z.number().int().min(0).max(3), explanation: z.string() }))
  .min(3)
  .max(6);

/** Single-turn agent: turns a card into spaced-repetition questions. */
export async function generateQuiz(date: string, markdown: string) {
  const { text } = await runAgent({
    agent: "history.quizmaster",
    instructions: `Write 4 multiple-choice questions that test durable understanding (who/when/why/what-connected), not trivia about wording. Plausible distractors. Vary the answer position. Return ONLY JSON: [{"question","choices":[4 strings],"answer": index 0-3,"explanation": one sentence}]`,
    prompt: markdown,
  });
  const qs = parseJson(text, QuizSchema);
  const ins = db.prepare("INSERT INTO quiz_items(card_date, question, choices, answer, explanation, due) VALUES (?,?,?,?,?,?)");
  for (const q of qs) ins.run(date, q.question, JSON.stringify(q.choices), q.answer, q.explanation, date);
  return qs.length;
}

export function answerQuiz(id: number, choice: number) {
  const q = db.prepare("SELECT * FROM quiz_items WHERE id = ?").get(id) as { answer: number; box: number } | undefined;
  if (!q) throw new Error(`Quiz item ${id} not found`);
  const correct = q.answer === choice;
  const box = correct ? Math.min(q.box + 1, 6) : 0;
  const days = correct ? 2 ** box : 1;
  db.prepare("UPDATE quiz_items SET box = ?, due = date('now', 'localtime', ?), attempts = attempts + 1, correct = correct + ? WHERE id = ?").run(box, `+${days} days`, correct ? 1 : 0, id);
  return { correct, nextInDays: days };
}

export function tutorInstructions(context?: string | null) {
  return `You are a history tutor specialising in India and Europe from 3000 BC to 1100 AD, with good knowledge of the Near East and China for comparison.\n${PROFILE}\n- Be vivid and concrete: people, places, objects, primary sources (inscriptions, Arthashastra, Megasthenes, Xuanzang, Tacitus, Procopius…).\n- Distinguish evidence from tradition and flag scholarly debates (e.g., Aryan migration, dating the Buddha, the "Dark Ages" framing).\n- Use timeline_lookup and Wikipedia when you need dates or details; cite pages as links.\n- Markdown, under ~350 words unless asked. End with "**Meanwhile:** " — one line on what was happening elsewhere at the same time.${context ? `\n\nContext:\n${context}` : ""}`;
}

/** The student: picks a question about today's card and has a 2-turn conversation with the tutor. */
export async function curiousStudent() {
  const card = db.prepare("SELECT * FROM history_cards ORDER BY date DESC LIMIT 1").get() as { date: string; year: number; markdown: string } | undefined;
  if (!card) throw new Error("Student has no history card to read yet");
  const q = await runAgent({
    agent: "history.student",
    instructions: `You are an enthusiastic history student. After reading this card, ask the tutor ONE probing question (how do we know, why did it happen, what did it feel like, what came next). Output only the question.`,
    prompt: card.markdown,
  });
  const id = createConversation({ agent: "tutor", source: "student", title: q.text.trim().slice(0, 60), context: `Today's card: ${formatYear(card.year)}` });
  let messages = [textMessage("user", q.text.trim(), { by: "student" })];
  for (let turn = 0; turn < 2; turn++) {
    const r = await runAgent({
      agent: "history.tutor",
      maxSteps: 6,
      conversationId: id,
      tools: historyTools,
      instructions: tutorInstructions(`Today's card:\n${card.markdown.slice(0, 2000)}`),
      messages: toModelMessages(messages),
    });
    messages.push(textMessage("assistant", r.text, { tools: r.steps.flatMap((s) => (s.toolCalls ?? []).map((c) => c.toolName)) }));
    saveMessages(id, messages);
    if (turn === 0) {
      const f = await runAgent({
        agent: "history.student",
        conversationId: id,
        instructions: "You are the student. Ask one short follow-up that pushes deeper on the tutor's answer. Output only the question.",
        prompt: r.text,
      });
      messages.push(textMessage("user", f.text.trim(), { by: "student" }));
    }
  }
  messages = getConversation(id)!.messages;
  return { conversation: id, turns: messages.length };
}
