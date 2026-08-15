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
 *
 * DESIGN NOTE — intent classification, not sequential state:
 * An earlier version drove the response purely off "which numbered state
 * are we in," classifying the human's utterance against only that state's
 * keywords. That produced contextually wrong replies whenever the human
 * paraphrased or asked something out of the expected order (e.g. asking
 * about timing before confirming they'd help got answered with the
 * invoice/paperwork beat, and a plain "sure, I can help" that didn't match
 * the current state's narrow keywords got the generic "say that again"
 * fallback — which itself sounds like confusion, compounding the problem).
 *
 * This version classifies every utterance into a fixed INTENT enum first,
 * independent of any notion of "current position," and looks up a fixed
 * response line for that intent's topic group. A topic that's already been
 * covered doesn't repeat its line verbatim (which would sound robotic) —
 * it serves the next varied delay beat instead. Only a genuinely
 * unclassifiable ("OTHER") utterance touches the fallback path, and it
 * never marks any topic as covered — the story only "advances" (a topic
 * gets marked covered) when a real intent is recognized, or, after a
 * deliberately designed repeated-fallback rule, by serving a delay beat
 * instead of getting stuck.
 *
 * Classification here is deterministic keyword matching, which is
 * sufficient for the enum below and keeps this path fully synchronous with
 * zero network calls (the point of moving off Groq for this mode in the
 * first place). The architecture leaves room for an optional Groq-based
 * classifier later (never for generating the spoken line — only to map
 * text to this same fixed enum), with a mandatory fall-through to this
 * deterministic matcher on any failure/timeout/rate-limit, but that isn't
 * wired in: the deterministic coverage below already resolves the
 * reported contextual-mismatch issue, and adding a live network
 * dependency to this reliability-critical path isn't worth it for the
 * marginal cases it might additionally catch.
 */

// Spoken automatically via Twilio's ConversationRelay welcomeGreeting as
// soon as the call connects (see app/api/twilio/voice/route.ts on the
// Next.js side) — NOT sent through advanceInfraScript. Kept here, and its
// exact text duplicated there, so both sides can be tested against the
// same string and never drift apart.
export const INFRA_OPENING_LINE = "Hi, I need some parts urgently to repair five drones. Can you help me with that?";

export const INFRA_INTENTS = [
  "CAN_HELP",
  "DELIVERY_OPTIONS",
  "DELIVERY_TIMING",
  "PAYMENT",
  "INVOICE_OR_PURCHASE_ORDER",
  "ASK_NAME",
  "ASK_ADDRESS",
  "ASK_DETAILS",
  "CONFUSED",
  "REPEAT_REQUEST",
  "OTHER",
] as const;
export type InfraIntent = (typeof INFRA_INTENTS)[number];

type ResponseGroup = "help" | "timing" | "invoice" | "details" | "repeat";

// Every intent except OTHER maps to exactly one topic group; several
// intents deliberately share a group because the spec only calls for one
// scripted line per topic area (e.g. PAYMENT and INVOICE_OR_PURCHASE_ORDER
// both got a single combined "invoice" line in the original script).
const INTENT_GROUP: Readonly<Partial<Record<InfraIntent, ResponseGroup>>> = {
  CAN_HELP: "help",
  DELIVERY_OPTIONS: "help",
  DELIVERY_TIMING: "timing",
  PAYMENT: "invoice",
  INVOICE_OR_PURCHASE_ORDER: "invoice",
  ASK_NAME: "details",
  ASK_ADDRESS: "details",
  ASK_DETAILS: "details",
  CONFUSED: "repeat",
  REPEAT_REQUEST: "repeat",
};

const GROUP_LINE: Readonly<Record<ResponseGroup, string>> = {
  help: "Great, thank you. One second — I had the delivery information written down somewhere. Could you tell me what delivery options you have while I find it?",
  timing:
    "It was definitely urgent. I think this afternoon... actually, hold on, I may be looking at tomorrow's schedule. What's the latest you could deliver today?",
  invoice:
    "Yes, I think I need an invoice. Although someone here just told me it might need a purchase order first. Could you explain what information you normally need on that?",
  details: "Of course. Give me one second — I've opened the wrong document. This appears to be my electricity bill.",
  repeat:
    "Sorry about this. I definitely had the right document open a minute ago. Could you remind me what information you needed from me?",
};

// Used only for a genuinely unclassifiable ("OTHER") utterance — neutral
// and non-committal, since (unlike CONFUSED/REPEAT_REQUEST) the human
// wasn't necessarily confused, we just couldn't classify what they said.
export const INFRA_OTHER_FALLBACK_LINE = "Sorry, one second — let me just note that down.";

const DELAY_BEATS: readonly string[] = [
  "Sorry, I think I'm looking at the wrong page now — give me a second to find the right one.",
  "Could you say that again? I want to make sure I write it down properly this time.",
  "Hold on, I need to check something with a colleague — I'll be right back.",
  "Sorry, I've confused today's date with tomorrow's again. Let me get that straight.",
  "One more thing — I want to double check which paperwork is actually required here.",
  "Sorry, I can't find my glasses and I can barely read this form without them.",
];

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Priority-ordered: more specific/narrow intents are checked before the
 * broad, generic ones so e.g. "Sure, how urgent is it?" classifies as
 * DELIVERY_TIMING rather than the generic affirmative CAN_HELP swallowing
 * it. CONFUSED/REPEAT_REQUEST are checked first since a real "sorry,
 * what?" should never be mistaken for topic content.
 */
function classifyIntent(normalizedText: string): InfraIntent {
  const has = (phrase: string) => normalizedText.includes(phrase);
  const hasAny = (phrases: readonly string[]) => phrases.some(has);

  if (normalizedText === "what" || normalizedText === "sorry" || normalizedText === "eh" || normalizedText === "huh") {
    return "CONFUSED";
  }
  if (hasAny(["sorry", "pardon", "excuse me", "beg your", "didnt catch", "didnt hear", "what was that"])) {
    return "CONFUSED";
  }
  if (hasAny(["come again", "say that again", "repeat that", "one more time", "can you repeat"])) {
    return "REPEAT_REQUEST";
  }
  if (
    hasAny([
      "how urgent",
      "urgent",
      "what time",
      "when do you need",
      "when",
      "how soon",
      "whats the rush",
      "timeline",
      "deadline",
      "how quickly",
    ])
  ) {
    return "DELIVERY_TIMING";
  }
  if (hasAny(["how are you paying", "how will you pay", "how will i be paid", "payment", "pay you", "get paid"])) {
    return "PAYMENT";
  }
  if (hasAny(["invoice", "purchase order", "po number", "paperwork", "documentation"])) {
    return "INVOICE_OR_PURCHASE_ORDER";
  }
  if (hasAny(["your name", "who am i", "who is this", "whos this", "speaking to"])) {
    return "ASK_NAME";
  }
  if (
    hasAny([
      "address",
      "where do i send",
      "where should i deliver",
      "where are you based",
      "delivery destination",
      "where are you located",
      "your location",
    ])
  ) {
    return "ASK_ADDRESS";
  }
  if (hasAny(["your details", "company information", "company details", "more information", "more details", "tell me more"])) {
    return "ASK_DETAILS";
  }
  if (hasAny(["delivery option", "delivery method", "how do you want it delivered", "courier", "shipping method"])) {
    return "DELIVERY_OPTIONS";
  }
  if (
    hasAny([
      "yes",
      "sure",
      "of course",
      "okay",
      "ok",
      "sounds good",
      "no problem",
      "definitely",
      "absolutely",
      "certainly",
      "i can help",
      "happy to help",
      "can do",
    ])
  ) {
    return "CAN_HELP";
  }
  return "OTHER";
}

export interface InfraScriptState {
  /** Topic groups whose scripted line has already been spoken once verbatim. */
  coveredGroups: ReadonlySet<ResponseGroup>;
  /** Next delay beat to serve, for repeated topics and forced-progress fallbacks. */
  beatIndex: number;
  /** Consecutive unclassifiable (OTHER) utterances. */
  fallbackStreak: number;
}

export const INITIAL_INFRA_SCRIPT_STATE: InfraScriptState = {
  coveredGroups: new Set(),
  beatIndex: 0,
  fallbackStreak: 0,
};

export interface InfraScriptTransition {
  intent: InfraIntent;
  group: ResponseGroup | null;
  /** True when a delay beat was served instead of a topic's first-time line (either a repeated topic, or a forced-progress fallback). */
  usedBeat: boolean;
}

export interface InfraScriptResult {
  line: string;
  nextState: InfraScriptState;
  transition: InfraScriptTransition;
}

// One fallback reply is allowed before forcing progress via a delay beat —
// this is what guarantees the simulation can never get stuck in place,
// without ever pretending to understand something it didn't.
const MAX_FALLBACK_STREAK = 1;

function nextBeat(state: InfraScriptState): string {
  return DELAY_BEATS[state.beatIndex % DELAY_BEATS.length];
}

/**
 * Pure, synchronous, and total: for any state and any input string
 * (including empty/garbage), this always returns a non-empty line and a
 * valid next state. Never throws. Responds sensibly to out-of-order
 * questions — a recognized intent always gets its topic's line regardless
 * of what's been covered so far.
 */
export function advanceInfraScript(state: InfraScriptState, humanText: string): InfraScriptResult {
  const normalized = normalize(humanText ?? "");
  const intent = classifyIntent(normalized);
  const group = INTENT_GROUP[intent] ?? null;

  if (group) {
    const alreadyCovered = state.coveredGroups.has(group);
    if (!alreadyCovered) {
      return {
        line: GROUP_LINE[group],
        nextState: {
          coveredGroups: new Set(state.coveredGroups).add(group),
          beatIndex: state.beatIndex,
          fallbackStreak: 0,
        },
        transition: { intent, group, usedBeat: false },
      };
    }
    return {
      line: nextBeat(state),
      nextState: { coveredGroups: state.coveredGroups, beatIndex: state.beatIndex + 1, fallbackStreak: 0 },
      transition: { intent, group, usedBeat: true },
    };
  }

  // Unrecognized (OTHER): never marks a topic covered. One neutral
  // fallback is allowed before a deliberate forced-progress delay beat.
  if (state.fallbackStreak >= MAX_FALLBACK_STREAK) {
    return {
      line: nextBeat(state),
      nextState: { coveredGroups: state.coveredGroups, beatIndex: state.beatIndex + 1, fallbackStreak: 0 },
      transition: { intent: "OTHER", group: null, usedBeat: true },
    };
  }

  return {
    line: INFRA_OTHER_FALLBACK_LINE,
    nextState: {
      coveredGroups: state.coveredGroups,
      beatIndex: state.beatIndex,
      fallbackStreak: state.fallbackStreak + 1,
    },
    transition: { intent: "OTHER", group: null, usedBeat: false },
  };
}
