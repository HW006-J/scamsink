# ScamSink

**Every minute a scammer spends talking to ScamSink is a minute they're not talking to a real victim.**

ScamSink is a phone number that answers scam calls with an AI persona designed to do exactly one thing: waste the caller's time, harmlessly, for as long as possible. A live dashboard shows the call as it happens — transcript, timer, and total time wasted.

> ScamSink turns scam calls into dead ends.

---

## Table of contents

1. [Problem statement](#problem-statement)
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
17. [Future work](#future-work)

---

## Problem statement

Phone scams work on volume — the more time a scammer spends on live calls, the more victims they eventually reach. Individually hanging up denies a scammer nothing; the next call is seconds away. ScamSink instead **absorbs** the call: it answers, sounds like a real, easily-confused person, and keeps the caller engaged for as long as possible, for free, at scale, without a human on the other end ever being at risk.

The only claim ScamSink makes is the one it can prove: total time spent interacting with the honeypot. It does not (and cannot) claim to have "saved" any specific victim.

## How it works

1. A scammer calls the ScamSink phone number.
2. Twilio answers and connects the call to an AI voice persona over a live, bidirectional audio session (Twilio ConversationRelay).
3. The persona — polite, slow, easily confused, endlessly willing to keep talking — strings the caller along using natural stalling techniques.
4. It never reveals genuine personal, financial, or authentication information, and never takes any real-world action the caller asks for.
5. Every turn of the call streams to a live operator dashboard: status, duration, and transcript.
6. When the caller hangs up, the dashboard shows total time wasted.

## Architecture

```
                                   ┌─────────────────────┐
   Scam caller                    │   Next.js (Vercel)   │
       │                          │  ─────────────────   │
       │ dials                    │  /api/twilio/voice    ◄── Twilio webhook (answers call,
       ▼                          │  /api/twilio/status    │   returns <Connect><ConversationRelay>)
┌─────────────┐   webhook (HTTP)  │  /api/dashboard-state  │
│   Twilio    │──────────────────►│  /                    │  Dashboard (polls every ~1s)
│  PSTN + CR  │                   │  /demo                │
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
│  → Anthropic (Claude) │
└─────────────────────┘
```

- **Next.js app** (this repo's root) handles the Twilio HTTP webhooks, serves the dashboard, and exposes a polling API backed by Postgres. Deploys to Vercel.
- **voice-server** is a small, always-on Node/TypeScript process that holds the ConversationRelay WebSocket open for the duration of each call, drives the LLM conversation, and writes the transcript straight to Postgres so the dashboard sees it live. Deploys to Railway, Render, or Fly.io — **not** Vercel, since Vercel's serverless functions can't hold a persistent WebSocket open for the length of a phone call.
- **Neon Postgres** is the single source of truth both services read/write directly (no ORM), shared between them via `DATABASE_URL`.

## Live demo flow

1. Open the dashboard. It shows **READY**, `00:00`, no active call.
2. Call the ScamSink number from a phone.
3. Within a few seconds the dashboard flips to **LIVE**, the timer starts ticking, and the caller's masked number appears.
4. Speak as a scammer, e.g. *"Hello, we're calling from your bank. There's been suspicious activity on your account."*
5. ScamSink answers naturally and stalls: *"Oh dear. Which account was that again?"*
6. The transcript panel updates live, both sides, as the conversation continues.
7. Hang up. The dashboard shows **CALL COMPLETE** with total time wasted and the full transcript.

## Tech stack

- **Next.js 16** (App Router), **TypeScript**, **Tailwind CSS v4**
- **Zod** for environment and API-boundary validation
- **Neon Postgres**, accessed directly via `pg` (no ORM)
- **Vitest** for unit tests
- **Twilio Voice + ConversationRelay** for the phone call and real-time speech/text bridge
- **Anthropic (Claude)** for the conversational persona, via the official `@anthropic-ai/sdk`

### Why Claude Haiku 4.5 for the voice loop

The voice server defaults to `claude-haiku-4-5` rather than a larger Claude model. This is a deliberate latency decision, not a cost-cutting one: ScamSink's entire value proposition depends on the gap between *"caller finishes speaking"* and *"ScamSink starts speaking back"* staying short enough to feel like a real phone call. Haiku's response latency is the best fit for that constraint. The model is fully configurable via `ANTHROPIC_MODEL` if you want to trade latency for a more capable model.

## Twilio architecture

Inbound call flow, using the current (2026) Twilio Voice API:

1. Twilio receives the inbound call and `POST`s to `PUBLIC_APP_URL/api/twilio/voice` (configured on the phone number).
2. The route validates the request's `X-Twilio-Signature` against the exact webhook URL and the account's auth token (`twilio.validateRequest`), creates a `calls` row (status `ringing`), and returns TwiML:
   ```xml
   <Response>
     <Connect>
       <ConversationRelay url="wss://voice-server/relay?callSid=...&token=..." welcomeGreeting="Hello? Sorry, who's calling?" />
     </Connect>
   </Response>
   ```
   The `url` embeds a short-lived, per-call HMAC token (see [Security & privacy](#security--privacy)) — not a static secret — so only a ConversationRelay session Twilio opens in response to *this specific call* can connect.
3. Twilio opens the WebSocket to `voice-server` and the two speak the [ConversationRelay message protocol](https://www.twilio.com/docs/voice/conversationrelay/websocket-messages) directly — `setup`, `prompt` (caller speech, transcribed), `interrupt`, and `dtmf` inbound; `text` (spoken response, streamed token-by-token) and `end` outbound.
4. In parallel, Twilio also `POST`s call-lifecycle events to `PUBLIC_APP_URL/api/twilio/status` (`initiated`, `ringing`, `in-progress`, `completed`, `busy`, `failed`, `no-answer`), which is validated the same way and used as a redundant, authoritative source for call status — independent of whether the WebSocket connection itself behaves correctly.

## Voice server architecture

`voice-server/` is a standalone Node process (own `package.json`, deployed independently):

- `src/index.ts` — HTTP server (health check) + WebSocket upgrade handling. Verifies the per-call relay token before accepting a connection.
- `src/relay-session.ts` — one instance per phone call. Parses inbound ConversationRelay messages, maintains conversation history, calls the AI provider, streams the reply back token-by-token, and persists the transcript.
- `src/ai/` — provider abstraction (`AIProvider` interface) with an Anthropic implementation. Selected via `AI_PROVIDER`. Throws rather than fabricating a response if the provider is unavailable.
- `src/persona.ts` — the system prompt (see below).
- `src/db.ts` — direct Postgres access (connection pool), independent of the Next.js app's copy.
- `src/redact.ts` — best-effort redaction of obvious sensitive numeric strings before anything is persisted.

**Low latency, on purpose:** replies are streamed from the LLM and forwarded to Twilio as `text` tokens as they're generated (not buffered until the full reply is ready), so text-to-speech playback can start before the model has finished "thinking." Interruptions from the caller cancel any in-flight reply generation.

**The persona** (`src/persona.ts`) is an ordinary, easily-confused person: it asks for repetition, forgets details, goes on brief tangents, and stalls indefinitely on any request to send money, install software, or read out a code — without ever refusing outright or breaking character. It is hard-coded to never produce a real-looking password, card number, account number, government ID, or seed phrase, and never to claim it isn't an AI unless safety requires ending the call. See the full prompt in `voice-server/src/persona.ts`.

## Neon setup

1. Create a Neon project and database.
2. Copy the pooled connection string into `DATABASE_URL` (both the Next.js app's and voice-server's environments — same value, same database).
3. Run migrations:
   ```bash
   npm run db:migrate
   ```
   This applies every `.sql` file in `neon/migrations/` in order, tracked in a `schema_migrations` table, safe to re-run.

Schema (see `neon/migrations/0001_init.sql`):

| Table | Purpose |
|---|---|
| `calls` | One row per phone call: Twilio CallSid, status, masked caller number, timing, persona. |
| `transcript_messages` | Turn-by-turn transcript (`caller` / `scamsink` / `system`), ordered by `created_at`. |
| `call_events` | Lifecycle/diagnostic events (status callbacks, connect/disconnect, provider errors) for debugging. |

The schema supports listing historical calls later, but the MVP dashboard only ever shows the most recent call.

## Environment variables

See `.env.example` (Next.js app) and `voice-server/.env.example` (voice server) for the full annotated list. Summary:

**Next.js app** (Vercel):
`DATABASE_URL`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER`, `PUBLIC_APP_URL`, `VOICE_SERVER_URL`, `VOICE_SERVER_SHARED_SECRET`

**voice-server** (Railway/Render/Fly):
`DATABASE_URL`, `TWILIO_AUTH_TOKEN`, `PUBLIC_APP_URL`, `VOICE_SERVER_SHARED_SECRET`, `AI_PROVIDER`, `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`, `PORT`

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

To actually receive a call locally you'll need a tunnel (e.g. `ngrok`) exposing both the Next.js app and voice-server, with `PUBLIC_APP_URL` / `VOICE_SERVER_URL` pointed at the tunnel URLs and the Twilio number's webhook pointed at the Next.js tunnel URL.

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

- **Caller numbers are masked** before they ever reach the dashboard (`lib/mask.ts`) — the full number is used only transiently to build the masked form and is not otherwise displayed. Prefer storing the minimum needed; the schema stores only the masked form.
- **Twilio webhook signatures are verified** on every request to `/api/twilio/*` (`lib/twilioAuth.ts`), computed against the exact public URL, not whatever `Host` header a request happens to carry.
- **The ConversationRelay WebSocket is authenticated**: the Next.js voice webhook mints a short-lived, per-CallSid HMAC token (`lib/relayAuth.ts`); voice-server verifies it with a constant-time comparison before accepting the connection (`voice-server/src/auth.ts`). Twilio's own request signing doesn't cover WebSocket upgrades, so this closes that gap.
- **Basic transcript redaction** (`redact.ts`, both services) strips obvious long digit runs (card numbers, OTP-style codes) before persisting transcript content. **This is a hackathon-grade safety net, not a production-grade sensitive-data redaction system** — it will miss anything that isn't a long digit run, and should not be relied on as the sole safeguard for genuinely sensitive data.
- Database credentials are never exposed to the browser — all Postgres access happens in server-only route handlers and the voice-server process.
- The persona is hard-constrained (see above) to never produce genuine-looking credentials and never take real-world action on the caller's instructions.

## Responsible-use boundaries

ScamSink is a **defensive, inbound-only** honeypot. By design, this project does **not**:

- Place outbound calls or auto-dial anyone.
- Scrape, buy, or otherwise acquire scam phone numbers.
- Spoof caller ID.
- Impersonate a real, specific victim.
- Use genuine financial, identity, or authentication information.
- Attempt to extract passwords, card numbers, OTPs, seed phrases, or credentials from a caller.
- Claim to have "prevented" any specific harm — only the time spent interacting with ScamSink is reported.

If a caller volunteers sensitive information unprompted, ScamSink does not repeat it back, store it verbatim where avoidable, or encourage further disclosure.

## Testing

```bash
npm run test              # Next.js app (Vitest)
cd voice-server && npm run test
```

Covers, across both services: call lifecycle transitions and idempotent status-callback handling, transcript persistence and speaker validation, duration calculation, phone-number masking, sensitive-data redaction, Twilio/relay authentication (including malformed and forged requests), and AI-provider failure handling. All fixtures use synthetic phone numbers and synthetic data.

## Known limitations

- Redaction is a best-effort digit-run filter, not a real PII/PCI-grade system (see above).
- Country-code detection in phone-number masking is a display heuristic, not real E.164 parsing.
- The dashboard polls once per second rather than using a push channel — simple and reliable for a single-call MVP, but not infinitely scalable.
- No automated integration test exercises a real Twilio call end-to-end (requires a live Twilio account and public URLs); this is verified manually against a real number.
- Single active call at a time by design — see below.

## Future work

- Scam-number transfer/routing between multiple concurrent honeypot lines.
- Richer scam-pattern classification and per-category personas.
- Additional persona voices/personalities, selectable per number.
- Aggregate, cross-call statistics.
- A leaderboard / community participation layer (explicitly out of scope for this MVP).
