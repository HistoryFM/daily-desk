export const config = {
  openrouterKey: process.env.OPENROUTER_API_KEY ?? "",
  modelFast: process.env.MODEL_FAST || "anthropic/claude-haiku-5.5",
  modelSmart: process.env.MODEL_SMART || "anthropic/claude-sonnet-5.5",
  dailyBudgetUsd: Number(process.env.DAILY_BUDGET_USD || 8),
  chaosRate: Number(process.env.CHAOS_RATE ?? 0),
  notify: process.env.NOTIFY !== "0",
  schedule: {
    wireMorning: process.env.WIRE_MORNING_AT || "06:00",
    wireEvening: process.env.WIRE_EVENING_AT || "18:00",
    history: process.env.HISTORY_AT || "07:00",
    student: process.env.STUDENT_AT || "13:00",
    recs: process.env.RECS_AT || "20:00",
  },
  userAgent: "DailyDesk/0.1 (personal reader)",
};

export function localDate(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function formatYear(y: number): string {
  return y < 0 ? `${-y} BC` : `${y} AD`;
}
