# The Daily Desk

A private newsroom of AI agents that runs on your laptop:

| Section | Agents | Kind |
|---|---|---|
| **Wire** | `wire.triage` scores every article from 10 feeds · `wire.editor.*` researches and writes the morning brief and evening wrap | single-turn · multi-step with tools |
| **Ask panel** (every page, ⌘K or `/`) | `explainer` (web search, fetch, Wikipedia, HN, news archive), or `history.tutor` on History. The server rebuilds the current page's content as context; highlight any passage → "Ask about this". `reader.*` asks the explainer 2-turn questions every morning; all threads are listed at `/ask` | multi-turn chat · self-play |
| **History** | `history.meanwhile` writes a daily India/Europe "Meanwhile…" card (3000 BC – 1100 AD) · `history.quizmaster` makes spaced-repetition questions · `history.tutor` + `history.student` | multi-step · single-turn · multi-turn |
| **Shelf** | chapter checker (MangaDex + Webtoons RSS, no LLM) · `shelf.recommender` (AniList tools) | job · multi-step |
| **System** | jobs, runs, spend by agent, budget | |

## Run it

```bash
npm install
npm run setup          # creates .env.local — add OPENROUTER_API_KEY
npm run service:install
```

Open http://localhost:4747. `service:install` builds the app and registers a macOS LaunchAgent that starts at login, restarts on crash, and keeps the scheduler running.

Other commands: `npm run service:logs`, `service:status`, `service:restart` (rebuild + restart after code or `.env.local` changes), `service:uninstall`. For development: `npm run dev`.

## Scheduling and sleep

The scheduler lives inside the server process and ticks every 30 s:

- **Daily jobs** (brief 06:00, history 07:00, student 13:00, evening 18:00, recs 20:00 — configurable in `.env.local`) run once per day. If the laptop was asleep at 06:00, the next tick after wake runs it (`trigger = catch-up`). A missed run from *yesterday* is still caught up, unless today's run is less than 3 hours away.
- **Interval jobs** (feeds every 3 h, chapters every 6 h) run when their last success is older than the interval.
- A gap between ticks is logged as a wake (shown on Today and System), and failed jobs retry up to 3× with a 20 min backoff.
- `reader.questions` waits for that day's `wire.morning`; `history.student` waits for `history.card`.

## Cost

Defaults: `anthropic/claude-haiku-5.5` for bulk/automated work, `anthropic/claude-sonnet-5.5` for the editor, the Meanwhile card and live chat. Every call's cost (from OpenRouter usage accounting) is stored and checked against `DAILY_BUDGET_USD` (default $8): over budget, jobs are skipped and chat returns 429. Also set a credit limit on the OpenRouter key itself. Expected spend is roughly $1–3/day.

## Observability

No monitoring SDK is installed. Job runs, errors and spend are visible on the System page and in `npm run service:logs` (lines prefixed `[desk]`). Agents already pass `telemetry.functionId` to the AI SDK, so an AI SDK-aware monitoring integration will name spans by agent once added. `CHAOS_RATE` (default 0) can make tool calls fail on purpose to exercise error paths.

Edit `src/lib/profile.ts` to change what the agents think you care about, and `src/lib/feeds.ts` to change sources.
