"use client";
import { useState, useTransition } from "react";
import { runJobNow } from "@/app/actions";

export function RunButton({ job, label = "Run now", className = "btn" }: { job: string; label?: string; className?: string }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <span className="inline-flex items-center gap-2">
      <button
        className={className}
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await runJobNow(job);
            setMsg(r.message);
          })
        }
      >
        {pending ? "Starting…" : label}
      </button>
      {msg && <span className="text-xs text-muted">{msg}</span>}
    </span>
  );
}
