/**
 * Deterministic comedy script for "CRITICAL INFRASTRUCTURE SIMULATION" demo
 * calls — a second scripted outbound demo mode, structurally similar to
 * demoScript.ts (a small, pure, synchronous state machine; no LLM
 * involved), themed as a vendor/procurement pretexting simulation instead
 * of a financial scam. This is a SIMULATION: it only ever runs on calls to
 * the same operator-authenticated, server-side allowlisted numbers used by
 * the existing demo — never a real technician, supplier, or third party.
 *
 * All content here is deliberately generic and fictional (unspecified
 * "parts", a round number of drones, a generic "delivery"/"invoice"/
 * "purchase order") — never a real military location, unit, weapons
 * specification, procurement credential, ID, payment detail, or
 * operational/targeting information.
 */

// Spoken automatically via Twilio's ConversationRelay welcomeGreeting as
// soon as the call connects (see app/api/twilio/voice/route.ts on the
// Next.js side) — NOT sent through advanceInfraScript. Kept here, and its
// exact text duplicated there, so both sides can be tested against the
// same string and never drift apart.
export const INFRA_OPENING_LINE = "Hi, I need some parts urgently to repair five drones. Can you help me with that?";

export interface InfraScriptState {
  /** Index of the next scripted line to speak once the human's utterance is accepted as matching. Starts at 1 — index 0 is the opening line, already spoken via welcomeGreeting. */
  index: number;
  fallbackStreak: number;
}

export const INITIAL_INFRA_SCRIPT_STATE: InfraScriptState = { index: 1, fallbackStreak: 0 };

export const INFRA_SCRIPT_FALLBACK_LINE =
  "Sorry, could you say that again? I want to make sure I've got this right.";

// Index 0 is a placeholder for INFRA_OPENING_LINE so state numbering lines
// up 1:1 with the spec's STATE 1..5 — advanceInfraScript never speaks it.
const CORE_LINES: readonly string[] = [
  INFRA_OPENING_LINE,
  "Great, thank you. One second — I had the delivery information written down somewhere. Could you tell me what delivery options you have while I find it?",
  "It was definitely urgent. I think this afternoon... actually, hold on, I may be looking at tomorrow's schedule. What's the latest you could deliver today?",
  "Yes, I think I need an invoice. Although someone here just told me it might need a purchase order first. Could you explain what information you normally need on that?",
  "Of course. Give me one second — I've opened the wrong document. This appears to be my electricity bill.",
  "Sorry about this. I definitely had the right document open a minute ago. Could you remind me what information you needed from me?",
];

const DELAY_BEATS: readonly string[] = [
  "Sorry, I think I'm looking at the wrong page now — give me a second to find the right one.",
  "Could you say that again? I want to make sure I write it down properly this time.",
  "Hold on, I need to check something with a colleague — I'll be right back.",
  "Sorry, I've confused today's date with tomorrow's again. Let me get that straight.",
  "One more thing — I want to double check which paperwork is actually required here.",
  "Sorry, I can't find my glasses and I can barely read this form without them.",
];

/** Once past the scripted array, cycles through the delay beats forever rather than repeating earlier beats. */
function lineForIndex(index: number): string {
  if (index < CORE_LINES.length) return CORE_LINES[index];
  const beatIndex = (index - CORE_LINES.length) % DELAY_BEATS.length;
  return DELAY_BEATS[beatIndex];
}

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Keyword sets for the only states where the human's utterance genuinely
// needs to say something specific to advance. Any index with no entry here
// (1 — reply to the opener, and 5+ — "keep engaging") auto-advances on any
// utterance instead — see isExpectedUtterance.
const STATE_KEYWORDS: Readonly<Record<number, readonly string[]>> = {
  2: ["what time", "when", "how urgent", "urgent", "how soon"],
  3: ["invoice", "payment", "purchase order", "po number", "paperwork", "documentation", "pay"],
  4: ["name", "address", "details", "company", "delivery destination", "where should", "who am i"],
};

function isExpectedUtterance(index: number, normalizedText: string): boolean {
  const keywords = STATE_KEYWORDS[index];
  if (!keywords) return true;
  return keywords.some((phrase) => normalizedText.includes(phrase));
}

export interface InfraScriptTransition {
  fromIndex: number;
  toIndex: number;
  matched: boolean;
}

export interface InfraScriptResult {
  line: string;
  nextState: InfraScriptState;
  transition: InfraScriptTransition;
}

// One fallback reply is allowed at a given state before forcing progress —
// this is what guarantees the simulation can never get stuck in place.
const MAX_FALLBACK_STREAK = 1;

/**
 * Pure, synchronous, and total: for any state and any input string
 * (including empty/garbage), this always returns a non-empty line and a
 * valid next state. Never throws.
 */
export function advanceInfraScript(state: InfraScriptState, humanText: string): InfraScriptResult {
  const normalized = normalize(humanText ?? "");
  const matched = isExpectedUtterance(state.index, normalized);

  if (matched || state.fallbackStreak >= MAX_FALLBACK_STREAK) {
    const toIndex = state.index + 1;
    return {
      line: lineForIndex(state.index),
      nextState: { index: toIndex, fallbackStreak: 0 },
      transition: { fromIndex: state.index, toIndex, matched },
    };
  }

  return {
    line: INFRA_SCRIPT_FALLBACK_LINE,
    nextState: { index: state.index, fallbackStreak: state.fallbackStreak + 1 },
    transition: { fromIndex: state.index, toIndex: state.index, matched: false },
  };
}
