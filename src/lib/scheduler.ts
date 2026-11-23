import { config, localDate } from "./config";
import { db, kvSet } from "./db";
import { BudgetExceededError, spentToday } from "./llm";

type Schedule = { type: "daily"; at: string } | { type: "every"; minutes: number };

export type Job = {
  name: string;
  label: string;
  schedule: Schedule;
  /** Only run once this job has succeeded for the same daily slot. */
  after?: string;
  usesLlm: boolean;
  run: () => Promise<unknown>;
};

/** SQLite datetime('now') is UTC without a zone marker. */
export const sqlTime = (s: string) => new Date(s.replace(" ", "T") + "Z");

const RETRY_AFTER_MIN = 20;
const MAX_ATTEMPTS = 3;
const TICK_MS = 30_000;
const CATCHUP_SKIP_IF_NEXT_WITHIN_H = 3;

let jobs: Job[] = [];
// Shared via globalThis: Next bundles instrumentation and routes separately, so module state is not shared.
const gs = globalThis as unknown as { __deskRunning?: Set<string> };
const running: Set<string> = gs.__deskRunning ?? (gs.__deskRunning = new Set<string>());
export const isRunning = (name: string) => running.has(name);

export function registerJobs(list: Job[]) {
  jobs = list;
}
export function getJobs() {
  return jobs;
}

function atToday(hhmm: string, base = new Date()) {
  const [h, m] = hhmm.split(":").map(Number);
  const d = new Date(base);
  d.setHours(h, m, 0, 0);
  return d;
}

/** The slot a job should currently have run for, or null if nothing is due. */
export function dueSlot(job: Job, now = new Date()): { slot: string; scheduledFor: Date } | null {
  if (job.schedule.type === "daily") {
    let at = atToday(job.schedule.at, now);
    if (at > now) {
      // Today's run isn't due yet — consider yesterday's missed run, unless today's is close.
      const hoursToNext = (at.getTime() - now.getTime()) / 3_600_000;
      if (hoursToNext < CATCHUP_SKIP_IF_NEXT_WITHIN_H) return null;
      at = new Date(at.getTime() - 86_400_000);
    }
    return { slot: localDate(at), scheduledFor: at };
  }
  const ms = job.schedule.minutes * 60_000;
  const last = db
    .prepare("SELECT started_at FROM job_runs WHERE job = ? AND status IN ('ok','running') ORDER BY id DESC LIMIT 1")
    .get(job.name) as { started_at: string } | undefined;
  const lastMs = last ? sqlTime(last.started_at).getTime() : 0;
  if (now.getTime() - lastMs < ms) return null;
  return { slot: new Date(Math.floor(now.getTime() / ms) * ms).toISOString().slice(0, 16), scheduledFor: new Date(lastMs ? lastMs + ms : now.getTime()) };
}

function slotState(job: string, slot: string) {
  const rows = db.prepare("SELECT status, finished_at FROM job_runs WHERE job = ? AND slot = ? ORDER BY id DESC").all(job, slot) as { status: string; finished_at: string | null }[];
  return {
    done: rows.some((r) => r.status === "ok"),
    attempts: rows.filter((r) => r.status === "error").length,
    lastFinished: rows[0]?.finished_at ? sqlTime(rows[0].finished_at) : null,
  };
}

/**
 * A manual run of a daily job fills the slot that is currently due (so "Run now" at 9am
 * counts as today's 6am run and the scheduler doesn't repeat it). Otherwise it gets its own slot.
 */
function manualSlot(job: Job): string {
  if (job.schedule.type === "daily") {
    const due = dueSlot(job);
    if (due && !slotState(job.name, due.slot).done) return due.slot;
  }
  return `manual-${new Date().toISOString()}`;
}

export async function runJob(job: Job, trigger: "schedule" | "catch-up" | "manual", slot = manualSlot(job)) {
  if (running.has(job.name)) return { skipped: "already running" };
  running.add(job.name);
  const runId = Number(db.prepare("INSERT INTO job_runs(job, slot, trigger, status) VALUES (?,?,?, 'running')").run(job.name, slot, trigger).lastInsertRowid);
  const finish = (status: string, detail: unknown) =>
    db.prepare("UPDATE job_runs SET status = ?, finished_at = datetime('now'), detail = ? WHERE id = ?").run(status, JSON.stringify(detail).slice(0, 4000), runId);
  try {
    if (job.usesLlm && !config.openrouterKey) {
      finish("skipped", { reason: "OPENROUTER_API_KEY is not set in .env.local" });
      return { skipped: "no key" };
    }
    if (job.usesLlm && spentToday() >= config.dailyBudgetUsd) {
      finish("skipped", { reason: "daily budget reached" });
      console.warn(`[desk] skipped ${job.name}: daily LLM budget reached`);
      return { skipped: "budget" };
    }
    console.log(`[desk] job ${job.name} starting (${trigger})`);
    const result = await job.run();
    finish("ok", result);
    console.log(`[desk] job ${job.name} ok`);
    return { ok: true, result };
  } catch (err) {
    finish("error", { message: err instanceof Error ? err.message : String(err) });
    console.error(`[desk] job ${job.name} failed:`, err instanceof BudgetExceededError ? err.message : err);
    return { ok: false, error: String(err) };
  } finally {
    running.delete(job.name);
  }
}

let ticking = false;
let lastTick = Date.now();

export async function tick() {
  const now = new Date();
  const gap = now.getTime() - lastTick;
  lastTick = now.getTime();
  if (gap > TICK_MS * 4) {
    const mins = Math.round(gap / 60_000);
    kvSet("last_wake", now.toISOString());
    console.log(`[desk] woke after ~${mins} min asleep; checking for missed jobs`);
  }
  if (ticking) return;
  ticking = true;
  try {
    for (const job of jobs) {
      const due = dueSlot(job, now);
      if (!due) continue;
      const state = slotState(job.name, due.slot);
      if (state.done || running.has(job.name)) continue;
      if (state.attempts >= MAX_ATTEMPTS) continue;
      if (state.lastFinished && now.getTime() - state.lastFinished.getTime() < RETRY_AFTER_MIN * 60_000) continue;
      if (job.after && job.schedule.type === "daily" && !slotState(job.after, due.slot).done) continue;
      const late = now.getTime() - due.scheduledFor.getTime() > 10 * 60_000;
      await runJob(job, late ? "catch-up" : "schedule", due.slot);
    }
  } finally {
    ticking = false;
  }
}

const g = globalThis as unknown as { __deskScheduler?: NodeJS.Timeout };

export function startScheduler() {
  if (g.__deskScheduler) return;
  // Anything left "running" belongs to a previous process that died.
  db.prepare("UPDATE job_runs SET status = 'error', finished_at = datetime('now'), detail = '{\"message\":\"process exited mid-run\"}' WHERE status = 'running'").run();
  lastTick = Date.now();
  g.__deskScheduler = setInterval(() => void tick(), TICK_MS);
  setTimeout(() => void tick(), 5_000);
  console.log(`[desk] scheduler started with ${jobs.length} jobs`);
}
