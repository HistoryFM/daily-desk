import { AskContext } from "@/components/AskPanel";
import { RunButton } from "@/components/RunButton";
import { Time } from "@/components/Time";
import { config, localDate } from "@/lib/config";
import { db, kvGet } from "@/lib/db";
import { JOBS } from "@/lib/jobs";
import { spentToday } from "@/lib/llm";

export const dynamic = "force-dynamic";

const STATUS: Record<string, string> = { ok: "text-ok", error: "text-bad", running: "text-warn", skipped: "text-muted" };

export default function System() {
  const last = (job: string) =>
    db.prepare("SELECT status, trigger, started_at, finished_at, detail FROM job_runs WHERE job = ? ORDER BY id DESC LIMIT 1").get(job) as
      | { status: string; trigger: string; started_at: string; finished_at: string | null; detail: string | null }
      | undefined;
  const runs = db.prepare("SELECT * FROM job_runs ORDER BY id DESC LIMIT 40").all() as {
    id: number;
    job: string;
    slot: string;
    trigger: string;
    status: string;
    started_at: string;
    finished_at: string | null;
    detail: string | null;
  }[];
  const byAgent = db
    .prepare("SELECT agent, model, COUNT(*) AS calls, SUM(input_tokens) AS tin, SUM(output_tokens) AS tout, SUM(cost_usd) AS cost FROM llm_usage WHERE date = ? GROUP BY agent, model ORDER BY cost DESC")
    .all(localDate()) as { agent: string; model: string; calls: number; tin: number; tout: number; cost: number }[];
  const week = db.prepare("SELECT date, SUM(cost_usd) AS cost FROM llm_usage GROUP BY date ORDER BY date DESC LIMIT 14").all() as { date: string; cost: number }[];
  const spent = spentToday();
  const maxWeek = Math.max(config.dailyBudgetUsd, ...week.map((w) => w.cost));

  return (
    <div className="space-y-14">
      <AskContext label="System" suggestions={["Did anything fail today, and why?", "Where is today's money going?", "Is the scheduler catching up properly after sleep?"]} />
      <section className="grid gap-6 sm:grid-cols-4">
        {[
          ["Spent today", `$${spent.toFixed(3)}`],
          ["Daily budget", `$${config.dailyBudgetUsd}`],
          ["Chaos rate", `${(config.chaosRate * 100).toFixed(0)}%`],
          ["Last wake", kvGet("last_wake") ? <Time key="w" utc={kvGet("last_wake")} mode="relative" /> : "—"],
        ].map(([k, v]) => (
          <div key={String(k)} className="border-t-2 border-ink pt-2">
            <div className="kicker">{k}</div>
            <div className="font-serif text-3xl mt-1">{v}</div>
          </div>
        ))}
      </section>

      <section>
        <h2 className="font-serif text-2xl mb-4">Jobs</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="kicker text-left">
              <tr className="border-b border-rule">
                <th className="py-2 font-normal">Job</th>
                <th className="font-normal">Schedule</th>
                <th className="font-normal">Last run</th>
                <th className="font-normal">Status</th>
                <th />
              </tr>
            </thead>
            <tbody className="divide-y divide-rule">
              {JOBS.map((j) => {
                const l = last(j.name);
                return (
                  <tr key={j.name}>
                    <td className="py-3">
                      <div>{j.label}</div>
                      <div className="font-mono text-xs text-muted">{j.name}</div>
                    </td>
                    <td className="text-ink-2">
                      {j.schedule.type === "daily" ? `daily ${j.schedule.at}` : `every ${j.schedule.minutes / 60}h`}
                      {j.after && <div className="text-xs text-muted">after {j.after}</div>}
                    </td>
                    <td className="text-ink-2">
                      {l ? <Time utc={l.started_at} mode="datetime" /> : "never"}
                      {l && <div className="text-xs text-muted">{l.trigger}</div>}
                    </td>
                    <td className={STATUS[l?.status ?? ""] ?? "text-muted"}>{l?.status ?? "—"}</td>
                    <td className="text-right">
                      <RunButton job={j.name} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <div className="grid gap-12 lg:grid-cols-2">
        <section>
          <h2 className="font-serif text-2xl mb-4">Spend by agent · today</h2>
          <table className="w-full text-sm">
            <tbody className="divide-y divide-rule">
              {byAgent.map((a) => (
                <tr key={a.agent + a.model}>
                  <td className="py-2">
                    {a.agent}
                    <div className="font-mono text-xs text-muted">{a.model}</div>
                  </td>
                  <td className="text-right text-muted font-mono text-xs">
                    {a.calls}× · {Math.round((a.tin + a.tout) / 1000)}k tok
                  </td>
                  <td className="text-right font-mono">${a.cost.toFixed(3)}</td>
                </tr>
              ))}
              {byAgent.length === 0 && (
                <tr>
                  <td className="py-3 text-muted">No LLM calls yet today.</td>
                </tr>
              )}
            </tbody>
          </table>
          {week.length > 0 && (
            <div className="mt-8">
              <div className="kicker mb-2">Last 14 days</div>
              <div className="flex items-end gap-1.5 h-24 border-b border-rule">
                {[...week].reverse().map((w) => (
                  <div key={w.date} className="flex-1 bg-ink/80 rounded-t-sm min-h-px" style={{ height: `${(w.cost / maxWeek) * 100}%` }} title={`${w.date}: $${w.cost.toFixed(2)}`} />
                ))}
              </div>
            </div>
          )}
        </section>

        <section>
          <h2 className="font-serif text-2xl mb-4">Recent runs</h2>
          <ul className="divide-y divide-rule text-sm border-y border-rule">
            {runs.map((r) => {
              let detail = "";
              try {
                const d = r.detail ? JSON.parse(r.detail) : null;
                detail = d?.message ?? d?.reason ?? (d?.result ? Object.entries(d.result).map(([k, v]) => `${k}: ${typeof v === "object" ? "…" : v}`).join(" · ") : "");
              } catch {}
              return (
                <li key={r.id} className="py-2">
                  <div className="flex justify-between gap-3">
                    <span className="font-mono text-xs">{r.job}</span>
                    <span className="text-xs text-muted">
                      <span className={STATUS[r.status]}>{r.status}</span> · {r.trigger} · <Time utc={r.started_at} mode="datetime" />
                    </span>
                  </div>
                  {detail && <div className="text-xs text-muted mt-0.5 line-clamp-2">{detail}</div>}
                </li>
              );
            })}
          </ul>
        </section>
      </div>
    </div>
  );
}
