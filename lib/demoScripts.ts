/**
 * Opening line for "CRITICAL INFRASTRUCTURE SIMULATION" demo calls, spoken
 * automatically via Twilio's ConversationRelay welcomeGreeting as soon as
 * the call connects (see app/api/twilio/voice/route.ts) — this is how
 * ScamSink "speaks first" for this mode, before any WS prompt/response
 * cycle begins. Its exact text is duplicated in
 * voice-server/src/infraScript.ts (as a reference for the state machine's
 * indexing, never re-sent from there) — keep both in sync.
 */
export const INFRA_SIMULATION_OPENING_LINE =
  "Hi, I need some parts urgently to repair five drones. Can you help me with that?";
