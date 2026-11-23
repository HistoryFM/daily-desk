"use client";
import { useState, useTransition } from "react";
import { submitQuiz } from "@/app/actions";

type Item = { id: number; question: string; choices: string[]; explanation: string | null; box: number };

export function Quiz({ items }: { items: Item[] }) {
  const [i, setI] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
  const [result, setResult] = useState<{ correct: boolean; nextInDays: number } | null>(null);
  const [score, setScore] = useState(0);
  const [pending, start] = useTransition();

  if (items.length === 0) return <p className="text-muted text-sm">Nothing due. New questions arrive with each day&apos;s card.</p>;
  if (i >= items.length)
    return (
      <div className="card p-6 text-center">
        <div className="font-serif text-2xl mb-1">
          {score} / {items.length}
        </div>
        <p className="text-sm text-muted">Done for today. Misses come back tomorrow; hits come back later and later.</p>
      </div>
    );
  const q = items[i];
  return (
    <div className="card p-6">
      <div className="flex justify-between kicker mb-3">
        <span>
          Question {i + 1} of {items.length}
        </span>
        <span>box {q.box}</span>
      </div>
      <p className="font-serif text-xl leading-snug mb-5">{q.question}</p>
      <div className="grid gap-2">
        {q.choices.map((c, idx) => {
          const state = result == null ? "" : idx === picked ? (result.correct ? "border-ok text-ok" : "border-bad text-bad") : "";
          return (
            <button
              key={idx}
              disabled={result != null || pending}
              onClick={() => {
                setPicked(idx);
                start(async () => {
                  const r = await submitQuiz(q.id, idx);
                  setResult(r);
                  if (r.correct) setScore((s) => s + 1);
                });
              }}
              className={`text-left border border-rule rounded px-4 py-2.5 hover:bg-paper-2 transition-colors ${state}`}
            >
              <span className="font-mono text-xs text-muted mr-3">{"ABCD"[idx]}</span>
              {c}
            </button>
          );
        })}
      </div>
      {result && (
        <div className="mt-5 flex items-start justify-between gap-4">
          <p className="text-sm text-ink-2">
            <strong className={result.correct ? "text-ok" : "text-bad"}>{result.correct ? "Right." : "Not quite."}</strong> {q.explanation}{" "}
            <span className="text-muted">Back in {result.nextInDays}d.</span>
          </p>
          <button
            className="btn btn-accent shrink-0"
            onClick={() => {
              setI(i + 1);
              setPicked(null);
              setResult(null);
            }}
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
