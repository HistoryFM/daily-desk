"use client";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

type Part = { type: string; text?: string; state?: string; toolName?: string; errorText?: string };

const TOOL_LABEL: Record<string, string> = {
  web_search: "Searched the web",
  fetch_url: "Read a page",
  wikipedia_search: "Searched Wikipedia",
  wikipedia_page: "Read Wikipedia",
  hn_search: "Searched Hacker News",
  search_news: "Checked the archive",
  timeline_lookup: "Checked the timeline",
};

function ToolChip({ part }: { part: Part }) {
  const name = part.toolName ?? part.type.replace(/^tool-/, "");
  const failed = part.state === "output-error";
  const done = part.state === "output-available" || failed;
  return (
    <span className={`chip mr-1.5 mb-1.5 ${failed ? "!text-bad !border-bad/40" : ""}`} title={part.errorText}>
      {!done && <span className="mr-1 animate-pulse">◌</span>}
      {TOOL_LABEL[name] ?? name}
      {failed && " · failed"}
    </span>
  );
}

/** Splits a user message into the passage they quoted from the page (lines starting with ">") and their question. */
export function splitQuote(text: string) {
  const lines = text.split("\n");
  const quote: string[] = [];
  while (lines.length && lines[0].startsWith(">")) quote.push(lines.shift()!.replace(/^>\s?/, ""));
  return { quote: quote.join(" ").trim(), question: lines.join("\n").trim() };
}

export function Message({ m, agent, compact = false }: { m: UIMessage; agent: string; compact?: boolean }) {
  const parts = m.parts as Part[];
  const meta = m.metadata as { by?: string; tools?: string[] } | undefined;
  const text = parts.filter((p) => p.type === "text").map((p) => p.text).join("\n");
  const tools = parts.filter((p) => p.type.startsWith("tool-") || p.type === "dynamic-tool");
  if (m.role === "user") {
    const { quote, question } = splitQuote(text);
    return (
      <div className={compact ? "pt-5 pb-4 border-t border-rule first:border-t-0 first:pt-1" : "py-6 border-t border-rule"}>
        <div className="kicker mb-1.5">{meta?.by === "reader" ? "The reader" : meta?.by === "student" ? "The student" : "You"}</div>
        {quote && (
          <blockquote className={`border-l-2 border-accent/60 pl-3 mb-2 font-serif italic text-ink-2 ${compact ? "text-sm line-clamp-4" : "text-base"}`}>{quote}</blockquote>
        )}
        <p className={`font-serif leading-snug ${compact ? "text-lg" : "text-xl"}`}>{question || (quote ? "" : text)}</p>
      </div>
    );
  }
  return (
    <div className={compact ? "pb-5" : "pb-6"}>
      <div className="kicker mb-2">{agent === "tutor" ? "Tutor" : "Explainer"}</div>
      {(tools.length > 0 || meta?.tools?.length) && (
        <div className="flex flex-wrap mb-2">
          {tools.map((p, i) => (
            <ToolChip key={i} part={p} />
          ))}
          {!tools.length && meta?.tools?.map((t, i) => <ToolChip key={i} part={{ type: `tool-${t}`, state: "output-available" }} />)}
        </div>
      )}
      <div className={`prose prose-desk max-w-none font-serif ${compact ? "prose-base prose-p:leading-relaxed" : "prose-lg"}`}>
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ a: ({ node: _n, ...p }) => <a {...p} target="_blank" rel="noreferrer" /> }}>
          {text}
        </ReactMarkdown>
      </div>
    </div>
  );
}

export function Chat({ id, agent, initial, autoAsk }: { id: string; agent: string; initial: UIMessage[]; autoAsk?: string }) {
  const transport = useMemo(() => new DefaultChatTransport({ api: "/api/chat" }), []);
  const { messages, sendMessage, status, error, stop } = useChat({ id, messages: initial, transport });
  const [input, setInput] = useState("");
  const asked = useRef(false);
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!autoAsk || asked.current || initial.length > 0) return;
    // Deferred so a mount that React immediately discards (Strict Mode, fast refresh) doesn't
    // consume the one-shot question; only the mount that survives sends it.
    const t = setTimeout(() => {
      if (asked.current) return;
      asked.current = true;
      void sendMessage({ text: autoAsk });
      window.history.replaceState(null, "", `/ask/${id}`);
    }, 0);
    return () => clearTimeout(t);
  }, [autoAsk, id, initial.length, sendMessage]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length, status]);

  const busy = status === "submitted" || status === "streaming";
  const lastText = messages.at(-1)?.role === "assistant" ? (messages.at(-1)!.parts as Part[]).some((p) => p.type === "text" && p.text) : false;

  return (
    <div>
      {messages.map((m) => (
        <Message key={m.id} m={m} agent={agent} />
      ))}
      {busy && !lastText && (
        <div className="thinking text-muted text-2xl pb-6" aria-label="Thinking">
          <span>·</span>
          <span>·</span>
          <span>·</span>
        </div>
      )}
      {error && <div className="card p-4 text-sm text-bad mb-6">Something went wrong: {error.message}</div>}
      <form
        className="sticky bottom-4 mt-4 flex gap-2 bg-paper/90 backdrop-blur p-2 -mx-2 rounded-lg"
        onSubmit={(e) => {
          e.preventDefault();
          if (!input.trim() || busy) return;
          void sendMessage({ text: input.trim() });
          setInput("");
        }}
      >
        <input className="input" placeholder={agent === "tutor" ? "Ask the tutor…" : "Ask a follow-up…"} value={input} onChange={(e) => setInput(e.target.value)} />
        {busy ? (
          <button type="button" className="btn" onClick={() => stop()}>
            Stop
          </button>
        ) : (
          <button className="btn btn-accent">Ask</button>
        )}
      </form>
      <div ref={bottom} />
    </div>
  );
}
