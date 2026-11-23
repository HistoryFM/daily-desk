import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { generateText, isStepCount, tool, type ModelMessage, type Tool, type ToolSet } from "ai";
import { z } from "zod";
import { config, localDate } from "./config";
import { db } from "./db";

export class BudgetExceededError extends Error {
  constructor(spent: number) {
    super(`Daily LLM budget reached: $${spent.toFixed(2)} of $${config.dailyBudgetUsd.toFixed(2)}`);
    this.name = "BudgetExceededError";
  }
}

export class ChaosError extends Error {
  constructor(toolName: string) {
    super(`Chaos monkey: injected failure in tool "${toolName}"`);
    this.name = "ChaosError";
  }
}

const openrouter = createOpenRouter({
  apiKey: config.openrouterKey,
  headers: { "HTTP-Referer": "http://localhost:4747", "X-Title": "Daily Desk" },
});

export function model(id: string) {
  return openrouter(id, { usage: { include: true } });
}

export const fast = () => model(config.modelFast);
export const smart = () => model(config.modelSmart);

// ---------- spend tracking ----------

export function spentToday(): number {
  const row = db.prepare("SELECT COALESCE(SUM(cost_usd), 0) AS s FROM llm_usage WHERE date = ?").get(localDate()) as { s: number };
  return row.s;
}

export function assertBudget() {
  const spent = spentToday();
  if (spent >= config.dailyBudgetUsd) throw new BudgetExceededError(spent);
}

let pricing: Record<string, { in: number; out: number }> | null = null;
async function priceFor(modelId: string) {
  if (!pricing) {
    try {
      const res = await fetch("https://openrouter.ai/api/v1/models");
      const json = (await res.json()) as { data: { id: string; pricing: { prompt: string; completion: string } }[] };
      pricing = Object.fromEntries(json.data.map((m) => [m.id, { in: Number(m.pricing.prompt), out: Number(m.pricing.completion) }]));
    } catch {
      pricing = {};
    }
  }
  return pricing[modelId];
}

type UsageLike = {
  usage?: { inputTokens?: number; outputTokens?: number };
  steps?: { providerMetadata?: Record<string, unknown>; usage?: { raw?: { is_byok?: boolean } } }[];
};

type OpenRouterUsage = { cost?: number; costDetails?: { upstreamInferenceCost?: number } };

/**
 * OpenRouter's `cost` is what OpenRouter bills. With BYOK (your own provider key) that is
 * only OpenRouter's fee (often 0) and the provider bills `upstreamInferenceCost` separately,
 * so the true cost is the sum. Without BYOK, `cost` already includes upstream.
 */
function stepCost(s: NonNullable<UsageLike["steps"]>[number]): number | undefined {
  const u = (s.providerMetadata?.openrouter as { usage?: OpenRouterUsage } | undefined)?.usage;
  if (typeof u?.cost !== "number") return undefined;
  const upstream = u.costDetails?.upstreamInferenceCost ?? 0;
  const byok = s.usage?.raw?.is_byok ?? upstream > u.cost;
  return byok ? u.cost + upstream : u.cost;
}

export async function recordUsage(agent: string, modelId: string, r: UsageLike) {
  const input = r.usage?.inputTokens ?? 0;
  const output = r.usage?.outputTokens ?? 0;
  let cost = 0;
  let reported = false;
  for (const s of r.steps ?? []) {
    const c = stepCost(s);
    if (typeof c === "number") {
      cost += c;
      reported = true;
    }
  }
  if (!reported) {
    const p = await priceFor(modelId);
    if (p) cost = input * p.in + output * p.out;
  }
  db.prepare("INSERT INTO llm_usage(date, agent, model, input_tokens, output_tokens, cost_usd) VALUES (?,?,?,?,?,?)").run(
    localDate(),
    agent,
    modelId,
    input,
    output,
    cost,
  );
  const spent = spentToday();
  if (spent > config.dailyBudgetUsd * 0.8) console.warn(`[desk] LLM spend at $${spent.toFixed(2)} of $${config.dailyBudgetUsd} today`);
  return cost;
}

// ---------- tools ----------

/**
 * Wraps a tool so failures are logged and, with probability CHAOS_RATE (default 0),
 * fail on purpose to exercise error paths.
 */
export function deskTool<S extends z.ZodType, O>(
  name: string,
  description: string,
  inputSchema: S,
  fn: (input: z.infer<S>) => Promise<O>,
) {
  return tool({
    description,
    inputSchema,
    execute: async (input: z.infer<S>) => {
      try {
        if (config.chaosRate > 0 && Math.random() < config.chaosRate) throw new ChaosError(name);
        return await fn(input);
      } catch (err) {
        console.error(`[desk] tool ${name} failed:`, err instanceof Error ? err.message : err);
        throw err;
      }
    },
  } as never) as unknown as Tool;
}

// ---------- agent runner ----------

export type RunOpts = {
  agent: string;
  modelId?: string;
  instructions: string;
  prompt?: string;
  messages?: ModelMessage[];
  tools?: ToolSet;
  maxSteps?: number;
  conversationId?: string;
};

/** Runs a (possibly multi-step, tool-using) agent to completion, with budget + usage tracking. */
export async function runAgent(opts: RunOpts) {
  assertBudget();
  const modelId = opts.modelId ?? config.modelFast;
  {
    const common = {
      model: model(modelId),
      instructions: opts.instructions,
      tools: opts.tools,
      stopWhen: isStepCount(opts.maxSteps ?? 1),
      telemetry: { functionId: opts.agent },
    };
    const result = opts.messages
      ? await generateText({ ...common, messages: opts.messages })
      : await generateText({ ...common, prompt: opts.prompt ?? "" });
    await recordUsage(opts.agent, modelId, result as unknown as UsageLike);
    return result;
  }
}

/** Extracts a JSON value from model text (tolerates ```json fences and surrounding prose). */
export function parseJson<T>(text: string, schema: z.ZodType<T>): T {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fenced ? fenced[1] : text;
  const start = raw.search(/[[{]/);
  const end = Math.max(raw.lastIndexOf("}"), raw.lastIndexOf("]"));
  if (start < 0 || end < start) throw new Error(`Model did not return JSON: ${text.slice(0, 200)}`);
  return schema.parse(JSON.parse(raw.slice(start, end + 1)));
}
