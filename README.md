# ScamSink

**A defensive simulation: ScamSink calls an allowlisted test number and runs a deterministic, harmless "wasted time" script — a demonstration of diverting a hostile caller's attention, without ever contacting a real adversary.**

ScamSink is a phone-number-driven operator console. An operator enters a phone number already on a server-side allowlist, presses **Start call**, and Twilio calls that number using the ScamSink caller ID. Once answered, ScamSink speaks first and runs the **CRITICAL INFRASTRUCTURE SIMULATION** script — a small, fully deterministic state machine, not an LLM — that keeps the conversation going indefinitely, adapts to whatever the other person says, and proactively continues the story even through silence. A live dashboard shows the call as it happens — transcript, timer, and cumulative time diverted.

> This is a simulation. It never dials a number that isn't explicitly allowlisted, and it never claims to have engaged a real adversary or real infrastructure personnel.

---

## Table of contents

1. [What this is](#what-this-is)
2. [How it works](#how-it-works)
3. [Architecture](#architecture)
4. [Live demo flow](#live-demo-flow)
5. [Tech stack](#tech-stack)
6. [Twilio architecture](#twilio-architecture)
7. [Voice server architecture](#voice-server-architecture)
8. [Neon setup](#neon-setup)
9. [Environment variables](#environment-variables)
10. [Local development](#local-development)
11. [Deployment](#deployment)
12. [Twilio phone number configuration](#twilio-phone-number-configuration)
13. [Security & privacy](#security--privacy)
14. [Responsible-use boundaries](#responsible-use-boundaries)
15. [Testing](#testing)
16. [Known limitations](#known-limitations)

---

## What this is

This started as a hackathon exploration of "waste a scam caller's time," including a real inbound-call honeypot powered by an LLM. That inbound flow has been removed. The product now demonstrates a narrower, more controllable idea: **an operator-triggered outbound simulation** that shows how a fully scripted, deterministic voice agent can keep a conversation going indefinitely — adapting to paraphrases, ignoring dead air, and never running out of things to say — without any LLM in the reply-generation path at all.

Any call this product places goes only to a number the operator has explicitly allowlisted server-side. If someone dials the ScamSink Twilio number directly, they get a short, polite, non-interactive message and a hangup — never a script, never an AI conversation.

## How it works

1. An operator opens the dashboard, enters a phone number, and presses **Start call**.
2. The server validates the operator's passphrase and checks the number against a server-side allowlist — the browser never decides what's dialable.
3. Twilio places the call. When it's answered, ScamSink speaks first (Twilio's own connect-time TTS, via ConversationRelay's `welcomeGreeting`).
4. Every reply after that comes from a deterministic state machine (`voice-server/src/infraScript.ts`): it classifies what the other person said into a fixed set of intents, answers specific questions directly, and otherwise carries its own narrative forward — including proactively continuing after a timed silence window, with no network call in that path that could hang or fail.
5. Every turn streams to the live dashboard: status, timer, and transcript.
6. When the call ends, the dashboard shows total time diverted for that call, and the cumulative dashboard metrics update.

## Architecture

```
                                   ┌─────────────────────┐
   Operator (dashboard)            │   Next.js (Vercel)   │
       │                          │  ─────────────────   │
       │ "Start call" + number     │  /api/demo/start-call ◄── places the outbound call
       ▼                          │  /api/twilio/voice     │   (allowlist + operator-secret enforced)
┌─────────────┐   places call     │  /api/twilio/status    │
│   Twilio    │──────────────────►│  /api/dashboard-state  │
│  PSTN + CR  │                   │  /                     │  Dashboard (polls every ~1s)
└─────────────┘                   └──────────┬────────────┘
       │                                       │ writes/reads
       │ wss:// (ConversationRelay)             ▼
       │                              ┌───────────────────┐
       ▼                              │   Neon Postgres    │
┌─────────────────────┐               │  calls              │
│    voice-server      │──────────────►  transcript_messages│
│ (Railway/Render/Fly) │   writes      │  call_events        │
│                       │               └───────────────────┘
│  WS session per call  │
│  → deterministic      │
│    state machine       │
│    (no LLM)             │
└─────────────────────┘
```

- **Next.js app** (this repo's root) serves the dashboard, places outbound calls via the Twilio REST API (operator-authenticated, allowlisted), handles the Twilio HTTP webhooks, and exposes a polling API backed by Postgres. Deploys to Vercel.
- **voice-server** is a small, always-on Node/TypeScript process that holds the ConversationRelay WebSocket open for the duration of each call and runs the deterministic infrastructure-simulation script, writing the transcript straight to Postgres so the dashboard sees it live. Deploys to Railway, Render, or Fly.io — **not** Vercel, since Vercel's serverless functions can't hold a persistent WebSocket open for the length of a phone call.
- **Neon Postgres** is the single source of truth both services read/write directly (no ORM), shared between them via `DATABASE_URL`.

There is no LLM anywhere in the live call path. `voice-server` has no AI provider dependency at all.

## Live demo flow

1. Open the dashboard. It shows **READY**, `00:00`, no active call.
2. Enter an allowlisted phone number and press **Start call**; enter the operator passphrase if prompted.
3. Answer the call — ScamSink speaks first with the infrastructure-simulation opening line.
4. Play along as the person receiving the call. Try a vague answer, an unrelated remark, or just staying silent — the state machine keeps the conversation moving regardless.
5. The transcript panel updates live as the conversation continues.
6. Hang up. The dashboard shows **CALL COMPLETE** with time diverted for that call, and the cumulative metrics at the top update.

## Tech stack

- **Next.js 16** (App Router), **TypeScript**, **Tailwind CSS v4**
- **Zod** for environment and API-boundary validation
- **Neon Postgres**, accessed directly via `pg` (no ORM)
- **Vitest** for unit tests
- **Twilio Voice + ConversationRelay** for the phone call and real-time speech/text bridge
- No LLM/AI SDK dependency — the entire spoken side of every call is a deterministic state machine

## Twilio architecture

Using the current (2026) Twilio Voice API:

**Outbound (the only real call flow):**

1. `/api/demo/start-call` validates the operator passphrase, normalizes and allowlist-checks the destination number server-side, enforces the one-active-call guard and a creation rate limit, then calls `client.calls.create(...)` and pre-creates the `calls` row (status `ringing`, direction `outbound_demo`).
2. Twilio calls the number and `POST`s to `PUBLIC_APP_URL/api/twilio/voice`. The route validates the request's `X-Twilio-Signature`, finds the pre-created row, and returns TwiML with ScamSink's opening line as the `welcomeGreeting` — so it speaks first, before the WebSocket session even starts:
   ```xml
   <Response>
     <Connect>
       <ConversationRelay url="wss://voice-server/relay?callSid=...&token=..." welcomeGreeting="Hi, I need some parts urgently..." />
     </Connect>
   </Response>
   ```
   The `url` embeds a short-lived, per-call HMAC token (see [Security & privacy](#security--privacy)) — not a static secret — so only a ConversationRelay session Twilio opens in response to *this specific call* can connect.
3. Twilio opens the WebSocket to `voice-server` and the two speak the [ConversationRelay message protocol](https://www.twilio.com/docs/voice/conversationrelay/websocket-messages) directly — `setup`, `prompt` (caller speech, transcribed), `interrupt`, and `dtmf` inbound; `text` (spoken response) and `end` outbound.
4. In parallel, Twilio `POST`s call-lifecycle events to `PUBLIC_APP_URL/api/twilio/status`, validated the same way, used as an authoritative source for call status.

**Unrecognized inbound (someone dials the number directly):** `/api/twilio/voice` looks up the CallSid; if no row was pre-created by `/api/demo/start-call`, it returns a plain `<Say>...</Say><Hangup/>` response — no ConversationRelay connection, no database row, no script or AI involvement of any kind.

## Voice server architecture

`voice-server/` is a standalone Node process (own `package.json`, deployed independently):

- `src/index.ts` — HTTP server (health check) + WebSocket upgrade handling. Verifies the per-call relay token before accepting a connection.
- `src/relay-session.ts` — one instance per phone call. Parses inbound ConversationRelay messages, drives the deterministic infra-simulation script, manages the proactive-silence timer, and persists the transcript.
- `src/infraScript.ts` — the deterministic state machine: intent classification (keyword-based, not an LLM) plus a proactive narrative that advances on its own through vague/unintelligible/silent turns, while still answering specific questions on demand regardless of story position.
- `src/ttsTiming.ts` — conservative word-count-based estimate of how long a line takes to speak, used to time the proactive-silence continuation realistically (Twilio's ConversationRelay protocol has no playback-complete event).
- `src/db.ts` — direct Postgres access (connection pool), independent of the Next.js app's copy.
- `src/redact.ts` — best-effort redaction of obvious sensitive numeric strings before anything is persisted.

**No LLM.** Every reply is a hardcoded, reviewed string selected by pure, synchronous logic — there is no network call in the reply path that can hang, rate-limit, or fail.

## Neon setup

1. Create a Neon project and database.
2. Copy the pooled connection string into `DATABASE_URL` (both the Next.js app's and voice-server's environments — same value, same database).
3. Run migrations:
   ```bash
   npm run db:migrate
   ```
   This applies every `.sql` file in `neon/migrations/` in order, tracked in a `schema_migrations` table, safe to re-run.

Schema (see `neon/migrations/`):

| Table | Purpose |
|---|---|
| `calls` | One row per phone call: Twilio CallSid, status, direction, demo mode, masked number, timing, persona. |
| `transcript_messages` | Turn-by-turn transcript (`caller` / `scamsink` / `system`), ordered by `created_at`. |
| `call_events` | Lifecycle/diagnostic events (status callbacks, connect/disconnect, script state transitions) for debugging. |

Historical rows from an earlier, now-removed demo mode may still exist in the database — they're never deleted, and dashboard metrics are explicitly scoped to exclude them rather than misrepresent them.

## Environment variables

See `.env.example` (Next.js app) and `voice-server/.env.example` (voice server) for the full annotated list. Summary:

**Next.js app** (Vercel):
`DATABASE_URL`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER`, `PUBLIC_APP_URL`, `VOICE_SERVER_URL`, `VOICE_SERVER_SHARED_SECRET`, and optionally `DEMO_PHONE_NUMBER` / `DEMO_OPERATOR_SECRET` / `DEMO_ALLOWED_PHONE_NUMBERS` to enable the dashboard's call console.

**voice-server** (Railway/Render/Fly):
`DATABASE_URL`, `TWILIO_AUTH_TOKEN`, `PUBLIC_APP_URL`, `VOICE_SERVER_SHARED_SECRET`, `PORT` — no AI-provider configuration needed.

`VOICE_SERVER_SHARED_SECRET` must be identical on both sides — generate one with `openssl rand -hex 32`.

## Local development

Requires Node 20+ and a Neon (or any Postgres) database.

```bash
# Next.js app
npm install
cp .env.example .env.local   # fill in values
npm run db:migrate
npm run dev                  # http://localhost:3000

# voice-server, in a second terminal
cd voice-server
npm install
cp .env.example .env         # fill in values
npm run dev                  # ws://localhost:8080/relay
```

To actually place a call locally you'll need a tunnel (e.g. `ngrok`) exposing both the Next.js app and voice-server, with `PUBLIC_APP_URL` / `VOICE_SERVER_URL` pointed at the tunnel URLs and the Twilio number's webhook pointed at the Next.js tunnel URL.

## Deployment

- **Next.js app → Vercel.** Import the repo (root directory), set the Next.js-app environment variables above, deploy. `vercel.json` is not required — the default Next.js build works as-is.
- **Neon** → create a project, run `npm run db:migrate` against it once (from your machine or CI) with `DATABASE_URL` set.
- **voice-server → Railway, Render, or Fly.io.** Any of the three works; Railway and Render both auto-detect a Node app from `voice-server/package.json` (`npm run build && npm start`) with minimal config. Set the voice-server environment variables above; the platform provides `PORT` automatically.
- **Twilio** → see below.

This project deliberately avoids Docker — none of the three services need it for a single Node process.

## Twilio phone-number configuration

1. Buy a Twilio phone number capable of voice (Console → Phone Numbers).
2. Under the number's **Voice Configuration**, set **"A call comes in"** to a webhook: `https://<your-vercel-app>/api/twilio/voice`, HTTP `POST`.
3. Set the **status callback URL** to `https://<your-vercel-app>/api/twilio/status`, HTTP `POST`, for all call status events.
4. Set `TWILIO_PHONE_NUMBER` (Next.js app) to that number in E.164 format — it's shown on the dashboard and `/demo` page.

## Security & privacy

- **Every outbound call is authenticated and allowlisted**: `/api/demo/start-call` requires the operator passphrase (`lib/demoAuth.ts`, constant-time compare) and only ever dials a number already on a server-side allowlist — the browser sends a destination as a string, but never decides what's actually dialable. Rate-limited, and only one call may be active at a time.
- **Caller numbers are masked** before they ever reach the dashboard (`lib/mask.ts`) — the full number is used only transiently to place the call and build the masked form. The schema stores only the masked form.
- **Twilio webhook signatures are verified** on every request to `/api/twilio/*` (`lib/twilioAuth.ts`), computed against the exact public URL, not whatever `Host` header a request happens to carry.
- **The ConversationRelay WebSocket is authenticated**: the Next.js voice webhook mints a short-lived, per-CallSid HMAC token (`lib/relayAuth.ts`); voice-server verifies it with a constant-time comparison before accepting the connection (`voice-server/src/auth.ts`). Twilio's own request signing doesn't cover WebSocket upgrades, so this closes that gap.
- **An unrecognized call is never engaged**: someone dialing the Twilio number directly (no pre-created row) gets a plain, non-interactive hangup — never the script, never a database write.
- **Basic transcript redaction** (`redact.ts`, both services) strips obvious long digit runs before persisting transcript content. **This is a hackathon-grade safety net, not a production-grade sensitive-data redaction system.**
- Database credentials are never exposed to the browser — all Postgres access happens in server-only route handlers and the voice-server process.
- The scripted content is hard-constrained to never produce a genuine-looking credential, payment detail, or ID, and never a real military/infrastructure location or targeting information — see `voice-server/src/infraScript.ts`.

## Responsible-use boundaries

This is a **defensive simulation**, not a real engagement tool. By design, this project does **not**:

- Call any number that isn't explicitly on the server-side allowlist.
- Scrape, buy, or otherwise acquire real phone numbers to call.
- Spoof caller ID.
- Impersonate a real, specific person, technician, supplier, or organization.
- Use genuine financial, identity, or authentication information — every scripted detail (parts, drones, invoices, addresses) is deliberately generic and fictional.
- Claim that a real adversary or real infrastructure personnel were contacted — only time diverted on consenting, allowlisted test numbers is reported.

If a caller volunteers sensitive information unprompted, ScamSink does not repeat it back, store it verbatim where avoidable, or encourage further disclosure.

## Testing

```bash
npm run test              # Next.js app (Vitest)
cd voice-server && npm run test
```

Covers, across both services: call lifecycle transitions and idempotent status-callback handling, transcript persistence and speaker validation, duration calculation, phone-number masking and E.164 normalization, sensitive-data redaction, Twilio/relay authentication (including malformed and forged requests), the deterministic intent-classification and narrative-progression state machine (including regression tests for previously-reported contextual-mismatch bugs), TTS-timing estimation and the proactive-silence timer (including overlap/race prevention), and the safe-hangup path for unrecognized inbound calls. All fixtures use synthetic phone numbers and synthetic data.

## Known limitations

- Redaction is a best-effort digit-run filter, not a real PII/PCI-grade system (see above).
- Country-code detection in phone-number masking is a display heuristic, not real E.164 parsing.
- The dashboard polls once per second rather than using a push channel — simple and reliable for this scale, but not infinitely scalable.
- No automated integration test exercises a real Twilio call end-to-end (requires a live Twilio account and public URLs); this is verified manually against allowlisted test numbers.
- Single active call at a time by design.
