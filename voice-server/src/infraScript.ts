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
 * DESIGN — two separate layers:
 *
 * 1. intent: what the human just meant, classified deterministically
 *    (keyword matching) into a fixed enum, independent of any notion of
 *    "current position." A handful of specific, answerable intents
 *    (DELIVERY_TIMING, INVOICE_OR_PURCHASE_ORDER/PAYMENT, ASK_ADDRESS,
 *    ASK_NAME/ASK_DETAILS, DELIVERY_OPTIONS) directly override whatever
 *    ScamSink was otherwise going to say next — "intent overrides
 *    narrative order."
 *
 * 2. narrativePhase: ScamSink's OWN ongoing fictional story, which it
 *    proactively advances through a fixed ordered sequence of beats
 *    whenever the human's utterance ISN'T a specific answerable question
 *    — a vague affirmative ("yeah"/"sure"/"right"), something
 *    unintelligible, something unrelated, or genuine silence. ScamSink
 *    never just waits for "the right thing" to be said: any of those
 *    cases is treated as permission to continue its own story, exactly
 *    like a real person would keep talking rather than going quiet. Only
 *    a genuine, explicit request for clarification (CONFUSED /
 *    REPEAT_REQUEST — "sorry, what?") gets a non-advancing restate,
 *    since that's the one case where barreling forward would be rude.
 *
 * Both layers share one set of topic beats (coveredPhases) so a topic
 * answered on demand is never repeated verbatim when the narrative later
 * reaches it naturally, and vice versa. Once every named phase has been
 * used, EXTENDED_DELAY cycles through a pool of generic beats forever, so
 * a long call never runs out of material.
 *
 * Classification here is deterministic keyword matching, sufficient for
 * the enum below and fully synchronous with zero network calls (the
 * point of moving off Groq for this mode). The architecture leaves room
 * for an optional Groq-based classifier later (never for generating the
 * spoken line — only to map text to this same fixed enum), with a
 * mandatory fall-through to this deterministic matcher on any
 * failure/timeout/rate-limit, but it isn't wired in: the deterministic
 * coverage below is sufficient, and adding a live network dependency to
 * this reliability-critical path isn't worth it for the marginal cases
 * it might additionally catch.
 */

// Spoken automatically via Twilio's ConversationRelay welcomeGreeting as
// soon as the call connects (see app/api/twilio/voice/route.ts on the
// Next.js side) — NOT sent through advanceInfraScript. Kept here, and its
// exact text duplicated there, so both sides can be tested against the
// same string and never drift apart. This is the OPENING narrative phase.
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

export const NARRATIVE_PHASES = [
  "DELIVERY_OPTIONS",
  "URGENCY",
  "PAPERWORK",
  "ADDRESS",
  "PAYMENT_CONFUSION",
  "WRONG_DOCUMENT",
  "CHECK_WITH_COLLEAGUE",
  "MIXED_UP_DATE",
  "LOOKING_FOR_DETAILS",
  "EXTENDED_DELAY",
] as const;
export type NarrativePhase = (typeof NARRATIVE_PHASES)[number];

type NamedPhase = Exclude<NarrativePhase, "EXTENDED_DELAY">;
const NAMED_PHASES = NARRATIVE_PHASES.filter((p): p is NamedPhase => p !== "EXTENDED_DELAY");

// Specific, answerable intents that jump straight to their topic's beat
// regardless of where the narrative currently is. Everything else (most
// notably CAN_HELP and OTHER) instead advances the narrative — see
// advanceInfraScript.
const INTENT_PHASE_OVERRIDE: Readonly<Partial<Record<InfraIntent, NamedPhase>>> = {
  DELIVERY_OPTIONS: "DELIVERY_OPTIONS",
  DELIVERY_TIMING: "URGENCY",
  PAYMENT: "PAPERWORK",
  INVOICE_OR_PURCHASE_ORDER: "PAPERWORK",
  ASK_ADDRESS: "ADDRESS",
  ASK_NAME: "WRONG_DOCUMENT",
  ASK_DETAILS: "WRONG_DOCUMENT",
};

const PHASE_LINE: Readonly<Record<NamedPhase, string>> = {
  DELIVERY_OPTIONS:
    "Great, thank you. One second — I had the delivery information written down somewhere. Could you tell me what delivery options you have while I find it?",
  URGENCY:
    "It was definitely urgent. I think this afternoon... actually, hold on, I may be looking at tomorrow's schedule. What's the latest you could deliver today?",
  PAPERWORK:
    "Yes, I think I need an invoice. Although someone here just told me it might need a purchase order first. Could you explain what information you normally need on that?",
  ADDRESS:
    "Let me just check what address I've got on file... actually, hold on, I think this might be for a different delivery.",
  PAYMENT_CONFUSION:
    "Sorry, I think I've mixed up which form was for payment and which was for delivery — hold on, let me sort these out.",
  WRONG_DOCUMENT: "Of course. Give me one second — I've opened the wrong document. This appears to be my electricity bill.",
  CHECK_WITH_COLLEAGUE: "Hold on, I need to check something with a colleague — I'll be right back.",
  MIXED_UP_DATE: "Sorry, I've confused today's date with tomorrow's again. Let me get that straight.",
  LOOKING_FOR_DETAILS: "Sorry, I think I'm looking at the wrong page now — give me a second to find the right one.",
};

// Cycled indefinitely once every named phase above has been covered, so a
// long call never runs out of material.
const EXTENDED_DELAY_LINES: readonly string[] = [
  "One more thing — I want to double check which paperwork is actually required here.",
  "Sorry, I can't find my glasses and I can barely read this form without them.",
  "Could you say that again? I want to make sure I write it down properly this time.",
  "Sorry, hold on — I think someone's calling me from the other room.",
  "One second, my screen just froze — let me try that again.",
  "Sorry, I keep getting distracted by all these bits of paper. Let me just gather them up.",
];

// Used only when the human explicitly signals confusion or asks us to
// repeat ourselves — the one case where continuing the story forward
// would be rude. Doesn't touch narrative progress either way.
const REPEAT_LINE =
  "Sorry about this. I definitely had the right document open a minute ago. Could you remind me what information you needed from me?";

// Defensive-only: advanceInfraScript is provably total and never throws,
// so this should never actually be used — it exists purely so the caller
// (relay-session.ts) always has a safe, non-empty line even in the face
// of an unexpected bug, matching the same defensive pattern used for the
// scam-honeypot script.
export const INFRA_SAFE_FALLBACK_LINE = "Sorry, one second — let me just check something here.";

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
 * what?" should never be mistaken for topic content. Empty/unintelligible
 * input falls through everything to OTHER, same as genuinely unrelated
 * speech — both are handled identically by advanceInfraScript (continue
 * the narrative), which is exactly the point.
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
      "yeah",
      "yep",
      "sure",
      "of course",
      "okay",
      "ok",
      "right",
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
  /** Named phases (and on-demand topics, which share the same set) already spoken once verbatim. */
  coveredPhases: ReadonlySet<NamedPhase>;
  /** Cycles through EXTENDED_DELAY_LINES once every named phase is covered. */
  extendedDelayIndex: number;
  /** Consecutive CONFUSED/REPEAT_REQUEST turns — see MAX_CONFUSED_STREAK. */
  confusedStreak: number;
}

export const INITIAL_INFRA_SCRIPT_STATE: InfraScriptState = {
  coveredPhases: new Set(),
  extendedDelayIndex: 0,
  confusedStreak: 0,
};

export interface InfraScriptTransition {
  intent: InfraIntent;
  phase: NarrativePhase | null;
  /** "direct" = intent-override answered its topic; "narrative" = the story advanced on its own; "clarify" = a non-advancing restate. */
  mode: "direct" | "narrative" | "clarify";
}

export interface InfraScriptResult {
  line: string;
  nextState: InfraScriptState;
  transition: InfraScriptTransition;
}

// However patient a real person would be, don't let persistent "sorry,
// what?" turns stall the story forever — after this many in a row, the
// next one continues the narrative instead of restating again.
const MAX_CONFUSED_STREAK = 2;

function firstUncoveredPhase(covered: ReadonlySet<NamedPhase>): NamedPhase | null {
  return NAMED_PHASES.find((phase) => !covered.has(phase)) ?? null;
}

function advanceNarrative(state: InfraScriptState, intent: InfraIntent): InfraScriptResult {
  const next = firstUncoveredPhase(state.coveredPhases);
  if (next) {
    return {
      line: PHASE_LINE[next],
      nextState: {
        coveredPhases: new Set(state.coveredPhases).add(next),
        extendedDelayIndex: state.extendedDelayIndex,
        confusedStreak: 0,
      },
      transition: { intent, phase: next, mode: "narrative" },
    };
  }
  return {
    line: EXTENDED_DELAY_LINES[state.extendedDelayIndex % EXTENDED_DELAY_LINES.length],
    nextState: {
      coveredPhases: state.coveredPhases,
      extendedDelayIndex: state.extendedDelayIndex + 1,
      confusedStreak: 0,
    },
    transition: { intent, phase: "EXTENDED_DELAY", mode: "narrative" },
  };
}

/**
 * Pure, synchronous, and total: for any state and any input string
 * (including empty — used for proactive silence continuations, see
 * relay-session.ts), this always returns a non-empty line and a valid
 * next state. Never throws.
 *
 * The human never needs to say "the right thing": a vague affirmative, an
 * unintelligible utterance, unrelated speech, or silence (empty string)
 * all fall through to advancing the narrative rather than stalling.
 */
export function advanceInfraScript(state: InfraScriptState, humanText: string): InfraScriptResult {
  const normalized = normalize(humanText ?? "");
  const intent = classifyIntent(normalized);

  if (intent === "CONFUSED" || intent === "REPEAT_REQUEST") {
    if (state.confusedStreak < MAX_CONFUSED_STREAK) {
      return {
        line: REPEAT_LINE,
        nextState: {
          coveredPhases: state.coveredPhases,
          extendedDelayIndex: state.extendedDelayIndex,
          confusedStreak: state.confusedStreak + 1,
        },
        transition: { intent, phase: null, mode: "clarify" },
      };
    }
    // Persistent confusion — stop restating and just carry the story forward.
    return advanceNarrative(state, intent);
  }

  const overridePhase = INTENT_PHASE_OVERRIDE[intent];
  if (overridePhase && !state.coveredPhases.has(overridePhase)) {
    return {
      line: PHASE_LINE[overridePhase],
      nextState: {
        coveredPhases: new Set(state.coveredPhases).add(overridePhase),
        extendedDelayIndex: state.extendedDelayIndex,
        confusedStreak: 0,
      },
      transition: { intent, phase: overridePhase, mode: "direct" },
    };
  }

  // CAN_HELP, OTHER (vague/unintelligible/unrelated/silence), or a direct
  // question about something already covered — all just continue the story.
  return advanceNarrative(state, intent);
}
