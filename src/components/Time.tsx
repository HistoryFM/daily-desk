"use client";
/** Renders a SQLite UTC timestamp in the viewer's local time. */
export function Time({ utc, mode = "time" }: { utc: string | null | undefined; mode?: "time" | "datetime" | "relative" }) {
  if (!utc) return <span>—</span>;
  const d = new Date(utc.includes("T") ? utc : utc.replace(" ", "T") + "Z");
  if (mode === "relative") {
    const s = (Date.now() - d.getTime()) / 1000;
    const txt = s < 60 ? "just now" : s < 3600 ? `${Math.round(s / 60)}m ago` : s < 86400 ? `${Math.round(s / 3600)}h ago` : `${Math.round(s / 86400)}d ago`;
    return <time dateTime={d.toISOString()} suppressHydrationWarning>{txt}</time>;
  }
  const opts: Intl.DateTimeFormatOptions = mode === "time" ? { hour: "numeric", minute: "2-digit" } : { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" };
  return <time dateTime={d.toISOString()} suppressHydrationWarning>{d.toLocaleString("en-US", opts)}</time>;
}
