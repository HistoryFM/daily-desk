"use client";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { createContext, Suspense, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Message } from "./Chat";

/**
 * The ask panel: one conversation drawer available on every page. Threads are scoped to the page
 * they were started from; the server rebuilds that page's content as the agent's context.
 */

type Agent = "explainer" | "tutor";
type PageInfo = { label: string; agent: Agent; suggestions: string[] };
type Focus = { article?: number };
type Pending = { text: string; focus?: Focus };

type Thread = { id: string; page: string; agent: Agent; label: string; focus?: Focus };

type AskApi = {
  open: boolean;
  setOpen: (v: boolean) => void;
  /** Opens the panel. `prompt` sends immediately in a fresh thread; `quote` attaches a highlighted passage. */
  openAsk: (o?: { prompt?: string; focus?: Focus; quote?: string; label?: string }) => void;
  registerPage: (p: PageInfo | null) => void;
};

const AskCtx = createContext<AskApi | null>(null);
export const useAsk = () => {
  const c = useContext(AskCtx);
  if (!c) throw new Error("useAsk outside AskProvider");
  return c;
};

const STORE = "desk.ask.thread";
const DEFAULT_PAGE: PageInfo = {
  label: "The desk",
  agent: "explainer",
  suggestions: ["How does a stablecoin issuer actually make money?", "What's the bull and bear case on AI capex right now?"],
};

const here = () => (typeof window === "undefined" ? "/" : window.location.pathname + window.location.search);
const newId = () => crypto.randomUUID();

function load<T>(key: string): T | null {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : null;
  } catch {
    return null;
  }
}
function save(key: string, v: unknown) {
  try {
    if (v == null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(v));
  } catch {}
}

export function AskProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpenState] = useState(false);
  const [page, setPage] = useState<PageInfo | null>(null);
  const [thread, setThread] = useState<Thread | null>(null);
  const [hasMessages, setHasMessages] = useState(false);
  const [initial, setInitial] = useState<UIMessage[]>([]);
  const [pending, setPending] = useState<Pending | null>(null);
  const [quote, setQuote] = useState("");
  const pageRef = useRef<PageInfo>(DEFAULT_PAGE);
  pageRef.current = page ?? DEFAULT_PAGE;

  const freshThread = useCallback((focus?: Focus, label?: string): Thread => {
    const p = pageRef.current;
    const t = { id: newId(), page: here(), agent: focus?.article ? "explainer" : p.agent, label: label ?? p.label, focus } satisfies Thread;
    setThread(t);
    setInitial([]);
    setHasMessages(false);
    save(STORE, t);
    return t;
  }, []);

  // Restore the last thread after a reload.
  useEffect(() => {
    const t = load<Thread>(STORE);
    if (!t) {
      freshThread();
      return;
    }
    fetch(`/api/chat?id=${t.id}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { messages: UIMessage[]; agent: Agent } | null) => {
        if (d?.messages?.length) {
          setInitial(d.messages);
          setHasMessages(true);
          setThread({ ...t, agent: d.agent });
        } else setThread(t);
      })
      .catch(() => setThread(t));
  }, [freshThread]);

  const setOpen = useCallback((v: boolean) => {
    setOpenState(v);
    document.documentElement.dataset.ask = v ? "open" : "";
  }, []);

  const openAsk = useCallback<AskApi["openAsk"]>(
    (o = {}) => {
      setOpen(true);
      // A thread belongs to the page it started on; asking from somewhere else starts a new one.
      const stale = !thread || (hasMessages && thread.page !== here());
      if (o.prompt) {
        freshThread(o.focus, o.label);
        setPending({ text: o.prompt, focus: o.focus });
        return;
      }
      if (stale) freshThread();
      if (o.quote) setQuote(o.quote);
      requestAnimationFrame(() => document.getElementById("ask-input")?.focus());
    },
    [freshThread, hasMessages, setOpen, thread],
  );

  // ⌘K / Ctrl+K toggles, "/" opens, Esc closes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && (e.target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName));
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (open) setOpen(false);
        else openAsk();
      } else if (e.key === "/" && !typing && !open) {
        e.preventDefault();
        openAsk();
      } else if (e.key === "Escape" && open) {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, openAsk, setOpen]);

  const api = useMemo<AskApi>(() => ({ open, setOpen, openAsk, registerPage: setPage }), [open, setOpen, openAsk]);

  return (
    <AskCtx.Provider value={api}>
      {children}
      <Suspense fallback={null}>
        <Panel
          open={open}
          onClose={() => setOpen(false)}
          page={page ?? DEFAULT_PAGE}
          thread={thread}
          initial={initial}
          pending={pending}
          clearPending={() => setPending(null)}
          quote={quote}
          setQuote={setQuote}
          onMessages={setHasMessages}
          onNew={() => freshThread()}
        />
      </Suspense>
      <SelectionBubble disabled={false} onAsk={(q) => openAsk({ quote: q })} />
      {!open && (
        <button
          onClick={() => openAsk()}
          className="fixed z-40 bottom-5 right-5 sm:bottom-6 sm:right-6 flex items-center gap-2 rounded-full bg-ink text-paper pl-4 pr-3 py-2.5 text-sm font-medium shadow-lg shadow-black/20 hover:opacity-90 transition"
          aria-label="Ask about this page"
        >
          <span className="text-accent">✦</span> Ask
          <kbd className="hidden sm:inline font-mono text-[0.7rem] opacity-60 border border-paper/30 rounded px-1 py-px">⌘K</kbd>
        </button>
      )}
    </AskCtx.Provider>
  );
}

/** Pages render this to tell the panel what they are about (the server builds the full text). */
export function AskContext({ label, agent = "explainer", suggestions }: { label: string; agent?: Agent; suggestions: string[] }) {
  const { registerPage } = useAsk();
  const key = `${label}|${agent}|${suggestions.join("|")}`;
  useEffect(() => {
    registerPage({ label, agent, suggestions });
    return () => registerPage(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, registerPage]);
  return null;
}

/** A button that opens the panel and asks straight away (e.g. "Dig in" on an article). */
export function AskButton({ prompt, focus, label, children, className = "btn text-xs" }: { prompt: string; focus?: Focus; label?: string; children: React.ReactNode; className?: string }) {
  const { openAsk } = useAsk();
  return (
    <button type="button" className={className} onClick={() => openAsk({ prompt, focus, label })}>
      {children}
    </button>
  );
}

/** Opens the panel without sending anything (for "Ask the tutor" style entry points). */
export function OpenAsk({ children, className = "btn" }: { children: React.ReactNode; className?: string }) {
  const { openAsk } = useAsk();
  return (
    <button type="button" className={className} onClick={() => openAsk()}>
      {children}
    </button>
  );
}

function Panel(props: {
  open: boolean;
  onClose: () => void;
  page: PageInfo;
  thread: Thread | null;
  initial: UIMessage[];
  pending: Pending | null;
  clearPending: () => void;
  quote: string;
  setQuote: (q: string) => void;
  onMessages: (has: boolean) => void;
  onNew: () => void;
}) {
  const { open, onClose, page, thread } = props;
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const current = pathname + (search ? `?${search}` : "");

  return (
    <>
      {open && <div className="fixed inset-0 z-40 bg-black/30 min-[1400px]:hidden sm:bg-black/10" onClick={onClose} aria-hidden />}
      <aside
        className={`fixed z-50 inset-y-0 right-0 w-full sm:w-[440px] bg-paper border-l border-rule shadow-2xl shadow-black/30 flex flex-col transition-transform duration-200 ${
          open ? "translate-x-0" : "translate-x-full pointer-events-none"
        }`}
        aria-hidden={!open}
        aria-label="Ask the desk"
      >
        {thread ? (
          <ThreadView key={thread.id} {...props} thread={thread} current={current} />
        ) : (
          <Header label={page.label} agent={page.agent} onNew={() => {}} onClose={onClose} canNew={false} />
        )}
      </aside>
    </>
  );
}

function Header({ label, agent, onNew, onClose, canNew }: { label: string; agent: Agent; onNew: () => void; onClose: () => void; canNew: boolean }) {
  return (
    <header className="px-5 pt-4 pb-3 border-b border-rule">
      <div className="flex items-center justify-between gap-3">
        <div className="kicker">Ask the desk</div>
        <div className="flex items-center gap-1 text-xs">
          {canNew && (
            <button onClick={onNew} className="px-2 py-1 rounded text-muted hover:text-ink hover:bg-paper-2">
              New thread
            </button>
          )}
          <Link href="/ask" className="px-2 py-1 rounded text-muted hover:text-ink hover:bg-paper-2">
            All threads
          </Link>
          <button onClick={onClose} className="ml-1 w-7 h-7 rounded text-muted hover:text-ink hover:bg-paper-2" aria-label="Close (Esc)">
            ✕
          </button>
        </div>
      </div>
      <div className="mt-2 flex items-center gap-2 min-w-0">
        <span className="chip shrink-0">{agent === "tutor" ? "Tutor" : "Explainer"}</span>
        <span className="text-sm text-ink-2 truncate font-serif">on {label}</span>
      </div>
    </header>
  );
}

function ThreadView({
  thread,
  initial,
  pending,
  clearPending,
  quote,
  setQuote,
  onMessages,
  onNew,
  onClose,
  open,
  page,
  current,
}: {
  thread: Thread;
  initial: UIMessage[];
  pending: Pending | null;
  clearPending: () => void;
  quote: string;
  setQuote: (q: string) => void;
  onMessages: (has: boolean) => void;
  onNew: () => void;
  onClose: () => void;
  open: boolean;
  page: PageInfo;
  current: string;
}) {
  const transport = useMemo(() => new DefaultChatTransport({ api: "/api/chat" }), []);
  const { messages, sendMessage, status, error, stop } = useChat({ id: thread.id, messages: initial, transport });
  const [input, setInput] = useState("");
  const scroller = useRef<HTMLDivElement>(null);
  const busy = status === "submitted" || status === "streaming";
  const started = messages.length > 0;
  // Before the first message the thread follows whatever page you're on.
  const label = started || thread.focus ? thread.label : page.label;
  const agent = started ? thread.agent : thread.focus?.article ? "explainer" : page.agent;
  const elsewhere = started && thread.page.split("#")[0] !== current;

  const send = useCallback(
    (text: string, focus?: Focus) => {
      const body = { page: started ? thread.page : current, focus: focus ?? thread.focus };
      if (!started) {
        thread.page = current;
        if (!thread.focus) thread.label = page.label;
        thread.agent = agent;
        save(STORE, thread);
      }
      void sendMessage({ text }, { body });
    },
    [agent, current, page.label, sendMessage, started, thread],
  );

  useEffect(() => onMessages(started), [started, onMessages]);

  // Auto-send a prompt handed over by a button; deferred so a discarded mount doesn't consume it.
  useEffect(() => {
    if (!pending || started) return;
    const t = setTimeout(() => {
      clearPending();
      send(pending.text, pending.focus);
    }, 0);
    return () => clearTimeout(t);
  }, [pending, started, clearPending, send]);

  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: status === "streaming" ? "auto" : "smooth" });
  }, [messages, status]);

  useEffect(() => {
    if (open) requestAnimationFrame(() => document.getElementById("ask-input")?.focus());
  }, [open]);

  const submit = () => {
    const q = input.trim();
    if ((!q && !quote) || busy) return;
    const text = quote ? `${quote.split("\n").map((l) => `> ${l}`).join("\n")}\n\n${q || "Explain this."}` : q;
    send(text);
    setInput("");
    setQuote("");
  };

  const lastHasText = messages.at(-1)?.role === "assistant" && messages.at(-1)!.parts.some((p) => p.type === "text" && "text" in p && p.text);

  return (
    <>
      <Header label={label} agent={agent} onNew={onNew} onClose={onClose} canNew={started} />
      {elsewhere && (
        <button onClick={onNew} className="mx-5 mt-3 text-left text-sm rounded-md border border-accent/40 bg-accent-soft px-3 py-2 hover:border-accent">
          You&apos;re on <span className="font-medium">{page.label}</span> now. <span className="text-accent">Start a thread about this page →</span>
        </button>
      )}
      <div ref={scroller} className="flex-1 overflow-y-auto px-5 py-4 overscroll-contain">
        {!started ? (
          <div className="pt-6">
            <p className="font-serif text-2xl leading-snug mb-1">What do you want to dig into?</p>
            <p className="text-sm text-muted mb-5">The {agent === "tutor" ? "tutor" : "explainer"} can see this page. Highlight any passage to ask about it.</p>
            <div className="flex flex-col items-start gap-2">
              {page.suggestions.map((s) => (
                <button key={s} onClick={() => send(s)} className="text-left font-serif text-[1.05rem] leading-snug rounded-md border border-rule px-3 py-2 hover:border-ink hover:bg-paper-2 transition-colors">
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((m) => <Message key={m.id} m={m} agent={agent} compact />)
        )}
        {busy && !lastHasText && (
          <div className="thinking text-muted text-2xl pb-4" aria-label="Thinking">
            <span>·</span>
            <span>·</span>
            <span>·</span>
          </div>
        )}
        {error && <div className="card p-3 text-sm text-bad mb-4">Something went wrong: {error.message}</div>}
      </div>
      <form
        className="border-t border-rule p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        {quote && (
          <div className="mb-2 flex items-start gap-2 rounded-md bg-paper-2 border-l-2 border-accent px-3 py-2">
            <p className="flex-1 font-serif italic text-sm text-ink-2 line-clamp-3">{quote}</p>
            <button type="button" onClick={() => setQuote("")} className="text-muted hover:text-ink text-xs" aria-label="Remove quote">
              ✕
            </button>
          </div>
        )}
        <div className="flex items-end gap-2">
          <textarea
            id="ask-input"
            rows={1}
            className="input resize-none max-h-40 font-serif text-base leading-snug"
            placeholder={quote ? "What about it? (Enter for “Explain this”)" : started ? "Ask a follow-up…" : "Ask about this page…"}
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              e.target.style.height = "auto";
              e.target.style.height = `${e.target.scrollHeight}px`;
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                submit();
              }
            }}
          />
          {busy ? (
            <button type="button" className="btn" onClick={() => stop()}>
              Stop
            </button>
          ) : (
            <button className="btn btn-accent">Ask</button>
          )}
        </div>
      </form>
    </>
  );
}

/** Floating "Ask about this" button that appears when you highlight text in the page. */
function SelectionBubble({ onAsk, disabled }: { onAsk: (q: string) => void; disabled: boolean }) {
  const [sel, setSel] = useState<{ text: string; x: number; y: number } | null>(null);

  useEffect(() => {
    if (disabled) return;
    let t: ReturnType<typeof setTimeout>;
    const update = () => {
      clearTimeout(t);
      t = setTimeout(() => {
        const s = window.getSelection();
        const text = s?.toString().trim() ?? "";
        if (!s || s.rangeCount === 0 || text.length < 3 || text.length > 2000) return setSel(null);
        const range = s.getRangeAt(0);
        const node = range.commonAncestorContainer;
        const el = node instanceof Element ? node : node.parentElement;
        if (!el?.closest("main") || el.closest("aside[aria-label='Ask the desk'], input, textarea, form")) return setSel(null);
        const rect = range.getBoundingClientRect();
        const x = Math.min(Math.max(rect.left + rect.width / 2, 70), window.innerWidth - 70);
        // Below the selection on touch screens (the OS menu sits above), above it otherwise.
        const touch = window.matchMedia("(pointer: coarse)").matches;
        const y = touch ? rect.bottom + 12 : rect.top - 44;
        setSel({ text, x, y: Math.max(8, y) });
      }, 120);
    };
    const clear = () => setSel(null);
    document.addEventListener("selectionchange", update);
    window.addEventListener("scroll", clear, { passive: true });
    return () => {
      clearTimeout(t);
      document.removeEventListener("selectionchange", update);
      window.removeEventListener("scroll", clear);
    };
  }, [disabled]);

  if (!sel) return null;
  return (
    <button
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => {
        onAsk(sel.text);
        window.getSelection()?.removeAllRanges();
        setSel(null);
      }}
      style={{ left: sel.x, top: sel.y }}
      className="fixed z-50 -translate-x-1/2 flex items-center gap-1.5 rounded-full bg-ink text-paper px-3.5 py-2 text-sm font-medium shadow-lg shadow-black/25 hover:opacity-90"
    >
      <span className="text-accent">✦</span> Ask about this
    </button>
  );
}
