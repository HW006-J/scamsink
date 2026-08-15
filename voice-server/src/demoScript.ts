/**
 * Deterministic comedy script for outbound demo calls. Reply selection here
 * is driven entirely by this state machine, never by an LLM — this exists
 * because free-form Groq replies became repetitive and occasionally stopped
 * responding during longer demo calls. advanceDemoScript is synchronous and
 * pure: there is no network call in this path that can hang, rate-limit, or
 * fail, so a scripted call can never go silent.
 */

export interface DemoScriptState {
  /** Index of the next scripted line to speak once the caller's utterance is accepted as matching. */
  index: number;
  /** Consecutive unrecognized utterances at the current index. */
  fallbackStreak: number;
}

export const INITIAL_DEMO_SCRIPT_STATE: DemoScriptState = { index: 0, fallbackStreak: 0 };

export const DEMO_SCRIPT_FALLBACK_LINE =
  "Sorry, I missed that — I'm still looking for the card. Give me one second.";

// Fragments below are deliberately meaningless as payment data: nothing
// here is a complete, valid-looking card number, expiry, CVV, or similar.
const CORE_LINES: readonly string[] = [
  "Oh wow, really? Yeah, one second, I'll go and get it.",
  "Almost — I just dropped it down the side of the sofa. Give me one second, I can see it.",
  "Okay, I've got it. It's... one... three... one...",
  "Oh, sorry! That's the price of the table I bought this morning. I'm looking at the receipt. Hold on, the card must be underneath it somewhere.",
  "Right, I've found another card now. Wait... no, this one's my library card. Sorry, give me another second.",
];

const DELAY_BEATS: readonly string[] = [
  "Hang on, I think that's the doorbell — might be a parcel I'm expecting. One moment.",
  "Sorry about that. Now, where were we... oh right, the card. Let me check my other pocket.",
  "I think I need my glasses to read the numbers properly. Give me just a second to find them.",
];

const FULL_SCRIPT: readonly string[] = [...CORE_LINES, ...DELAY_BEATS];

/** Once past the scripted array, cycles through the delay beats forever rather than repeating the opening jokes. */
function lineForIndex(index: number): string {
  if (index < FULL_SCRIPT.length) return FULL_SCRIPT[index];
  const beatIndex = (index - CORE_LINES.length) % DELAY_BEATS.length;
  return DELAY_BEATS[beatIndex];
}

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9£$\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Keyword sets for the only states where the caller's utterance genuinely
// needs to say something specific to advance. Any index with no entry here
// (0 — the opening pitch, and 4+ — "keep engaging") auto-advances on any
// utterance instead — see isExpectedUtterance.
const STATE_KEYWORDS: Readonly<Record<number, readonly string[]>> = {
  1: ["got it", "have you got", "have it", "find it", "found it", "do you have"],
  2: ["card number", "the number", "digits", "read", "tell me the", "what's your card", "numbers"],
  3: ["what", "sorry", "pardon", "come again", "say that again", "excuse me", "huh", "beg your"],
};

function isExpectedUtterance(index: number, normalizedText: string): boolean {
  const keywords = STATE_KEYWORDS[index];
  if (!keywords) return true;
  return keywords.some((phrase) => normalizedText.includes(phrase));
}

export interface DemoScriptTransition {
  fromIndex: number;
  toIndex: number;
  matched: boolean;
}

export interface DemoScriptResult {
  line: string;
  nextState: DemoScriptState;
  transition: DemoScriptTransition;
}

// One fallback reply is allowed at a given state before forcing progress —
// this is what guarantees the demo can never get stuck in place.
const MAX_FALLBACK_STREAK = 1;

/**
 * Pure, synchronous, and total: for any state and any input string
 * (including empty/garbage), this always returns a non-empty line and a
 * valid next state. Never throws.
 */
export function advanceDemoScript(state: DemoScriptState, callerText: string): DemoScriptResult {
  const normalized = normalize(callerText ?? "");
  const matched = isExpectedUtterance(state.index, normalized);

  if (matched || state.fallbackStreak >= MAX_FALLBACK_STREAK) {
    const toIndex = state.index + 1;
    return {
      // The line spoken corresponds to the state we're leaving (the one
      // the caller's utterance just satisfied), not the one after it.
      line: lineForIndex(state.index),
      nextState: { index: toIndex, fallbackStreak: 0 },
      transition: { fromIndex: state.index, toIndex, matched },
    };
  }

  return {
    line: DEMO_SCRIPT_FALLBACK_LINE,
    nextState: { index: state.index, fallbackStreak: state.fallbackStreak + 1 },
    transition: { fromIndex: state.index, toIndex: state.index, matched: false },
  };
}
