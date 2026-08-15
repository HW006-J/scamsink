import { describe, expect, it } from "vitest";
import {
  advanceInfraScript,
  INFRA_OPENING_LINE,
  INFRA_OTHER_FALLBACK_LINE,
  INITIAL_INFRA_SCRIPT_STATE,
} from "./infraScript.js";

const HELP_LINE =
  "Great, thank you. One second — I had the delivery information written down somewhere. Could you tell me what delivery options you have while I find it?";
const TIMING_LINE =
  "It was definitely urgent. I think this afternoon... actually, hold on, I may be looking at tomorrow's schedule. What's the latest you could deliver today?";
const INVOICE_LINE =
  "Yes, I think I need an invoice. Although someone here just told me it might need a purchase order first. Could you explain what information you normally need on that?";
const DETAILS_LINE =
  "Of course. Give me one second — I've opened the wrong document. This appears to be my electricity bill.";
const REPEAT_LINE =
  "Sorry about this. I definitely had the right document open a minute ago. Could you remind me what information you needed from me?";
const ALL_TOPIC_LINES = [HELP_LINE, TIMING_LINE, INVOICE_LINE, DETAILS_LINE, REPEAT_LINE];

describe("advanceInfraScript — bot opening line", () => {
  it("INFRA_OPENING_LINE is a fixed, non-empty string never returned by advanceInfraScript itself", () => {
    expect(INFRA_OPENING_LINE.length).toBeGreaterThan(0);
    const result = advanceInfraScript(INITIAL_INFRA_SCRIPT_STATE, "Yes, sounds good.");
    expect(result.line).not.toBe(INFRA_OPENING_LINE);
  });
});

describe("advanceInfraScript — regression: exact phrases from the real transcript", () => {
  it('"Sure. I can help with that." classifies as CAN_HELP and gets the delivery-info line, not a confused fallback', () => {
    const result = advanceInfraScript(INITIAL_INFRA_SCRIPT_STATE, "Sure. I can help with that.");
    expect(result.transition.intent).toBe("CAN_HELP");
    expect(result.line).toBe(HELP_LINE);
    expect(result.line).not.toContain("say that again");
  });

  it('"Sure. I can help with that." said AFTER the help topic is already covered gets a delay beat, not the "say that again" fallback', () => {
    const first = advanceInfraScript(INITIAL_INFRA_SCRIPT_STATE, "Sure, I can help.");
    const second = advanceInfraScript(first.nextState, "Sure. I can help with that.");
    expect(second.transition.intent).toBe("CAN_HELP");
    expect(second.transition.usedBeat).toBe(true);
    expect(second.line).not.toBe(INFRA_OTHER_FALLBACK_LINE);
  });

  it('"How urgent?" classifies as DELIVERY_TIMING and gets the timing line, never the invoice/purchase-order beat', () => {
    const result = advanceInfraScript(INITIAL_INFRA_SCRIPT_STATE, "How urgent?");
    expect(result.transition.intent).toBe("DELIVERY_TIMING");
    expect(result.line).toBe(TIMING_LINE);
    expect(result.line).not.toBe(INVOICE_LINE);
  });

  it('"How urgent?" gets the timing line regardless of what topics have already been covered (out-of-order)', () => {
    const afterHelp = advanceInfraScript(INITIAL_INFRA_SCRIPT_STATE, "Sure, I can help.");
    const afterInvoice = advanceInfraScript(afterHelp.nextState, "Do you need an invoice?");
    const result = advanceInfraScript(afterInvoice.nextState, "How urgent?");
    expect(result.transition.intent).toBe("DELIVERY_TIMING");
    expect(result.line).toBe(TIMING_LINE);
  });
});

describe("advanceInfraScript — broad paraphrase coverage per intent", () => {
  const cases: Array<{ phrase: string; intent: string; line: string }> = [
    { phrase: "How urgent is it?", intent: "DELIVERY_TIMING", line: TIMING_LINE },
    { phrase: "When do you need it?", intent: "DELIVERY_TIMING", line: TIMING_LINE },
    { phrase: "What time?", intent: "DELIVERY_TIMING", line: TIMING_LINE },
    { phrase: "How soon?", intent: "DELIVERY_TIMING", line: TIMING_LINE },
    { phrase: "Do you need an invoice?", intent: "INVOICE_OR_PURCHASE_ORDER", line: INVOICE_LINE },
    { phrase: "How are you paying?", intent: "PAYMENT", line: INVOICE_LINE },
    { phrase: "Purchase order?", intent: "INVOICE_OR_PURCHASE_ORDER", line: INVOICE_LINE },
    { phrase: "Do you need paperwork?", intent: "INVOICE_OR_PURCHASE_ORDER", line: INVOICE_LINE },
    { phrase: "Where do I send it?", intent: "ASK_ADDRESS", line: DETAILS_LINE },
    { phrase: "What's the delivery address?", intent: "ASK_ADDRESS", line: DETAILS_LINE },
    { phrase: "Where are you based?", intent: "ASK_ADDRESS", line: DETAILS_LINE },
    { phrase: "What's your name?", intent: "ASK_NAME", line: DETAILS_LINE },
    { phrase: "Who am I speaking to?", intent: "ASK_NAME", line: DETAILS_LINE },
    { phrase: "Sounds good, I can help.", intent: "CAN_HELP", line: HELP_LINE },
    // Contains both an affirmation and a specific delivery-destination question — the
    // more specific intent (ASK_ADDRESS) correctly wins, so the reply actually
    // addresses what was asked instead of just a generic acknowledgement.
    { phrase: "Sounds good, where should I deliver them?", intent: "ASK_ADDRESS", line: DETAILS_LINE },
  ];

  for (const { phrase, intent, line } of cases) {
    it(`"${phrase}" -> ${intent}`, () => {
      const result = advanceInfraScript(INITIAL_INFRA_SCRIPT_STATE, phrase);
      expect(result.transition.intent).toBe(intent);
      expect(result.line).toBe(line);
    });
  }

  it('a bare "What?" classifies as CONFUSED, not DELIVERY_TIMING', () => {
    const result = advanceInfraScript(INITIAL_INFRA_SCRIPT_STATE, "What?");
    expect(result.transition.intent).toBe("CONFUSED");
    expect(result.line).toBe(REPEAT_LINE);
  });

  it('"Sorry, come again?" classifies as a repeat-request and gets the repeat line', () => {
    const result = advanceInfraScript(INITIAL_INFRA_SCRIPT_STATE, "Sorry, come again?");
    expect(["CONFUSED", "REPEAT_REQUEST"]).toContain(result.transition.intent);
    expect(result.line).toBe(REPEAT_LINE);
  });
});

describe("advanceInfraScript — out-of-order questions answered sensibly", () => {
  it("asking for the address as the very first thing gets the address/details joke, not a generic fallback", () => {
    const result = advanceInfraScript(INITIAL_INFRA_SCRIPT_STATE, "Where should I deliver them?");
    expect(result.transition.intent).toBe("ASK_ADDRESS");
    expect(result.line).toBe(DETAILS_LINE);
  });

  it("asking about payment before anything else still gets the invoice/payment line", () => {
    const result = advanceInfraScript(INITIAL_INFRA_SCRIPT_STATE, "How are you paying for this?");
    expect(result.line).toBe(INVOICE_LINE);
  });
});

describe("advanceInfraScript — unrecognized utterance never auto-advances the story", () => {
  it("replies with the neutral fallback and does not mark any topic covered on the first mismatch", () => {
    const result = advanceInfraScript(INITIAL_INFRA_SCRIPT_STATE, "What's the weather like today?");
    expect(result.transition.intent).toBe("OTHER");
    expect(result.line).toBe(INFRA_OTHER_FALLBACK_LINE);
    expect(result.nextState.coveredGroups.size).toBe(0);
    expect(result.nextState.fallbackStreak).toBe(1);
  });

  it("force-progresses via a delay beat on a second consecutive mismatch, still without marking any topic covered", () => {
    const first = advanceInfraScript(INITIAL_INFRA_SCRIPT_STATE, "unrelated nonsense");
    const second = advanceInfraScript(first.nextState, "still unrelated nonsense");

    expect(second.transition.intent).toBe("OTHER");
    expect(second.transition.usedBeat).toBe(true);
    expect(second.nextState.coveredGroups.size).toBe(0);
    expect(second.nextState.fallbackStreak).toBe(0);
    expect(ALL_TOPIC_LINES).not.toContain(second.line);
  });

  it("a later recognized intent still gets its topic line even after earlier unrecognized turns", () => {
    const afterFallback = advanceInfraScript(INITIAL_INFRA_SCRIPT_STATE, "random chit chat");
    const result = advanceInfraScript(afterFallback.nextState, "How urgent is it?");
    expect(result.transition.intent).toBe("DELIVERY_TIMING");
    expect(result.line).toBe(TIMING_LINE);
  });
});

describe("advanceInfraScript — indefinite continuation / no-response prevention", () => {
  it("never returns an empty line, even for empty input", () => {
    const result = advanceInfraScript(INITIAL_INFRA_SCRIPT_STATE, "");
    expect(result.line.length).toBeGreaterThan(0);
  });

  it("never throws for garbage input", () => {
    expect(() => advanceInfraScript(INITIAL_INFRA_SCRIPT_STATE, "🚁🚁")).not.toThrow();
  });

  it("always returns a non-empty line across a long simulated conversation, mixing recognized and unrecognized turns", () => {
    let state = INITIAL_INFRA_SCRIPT_STATE;
    const turns = [
      "Sure, I can help.",
      "How urgent is it?",
      "random babble",
      "more random babble",
      "Do you need an invoice?",
      "What's your address?",
      "Sorry, what?",
      "still going on and on",
      "another random thing",
      "How urgent is it again?",
    ];
    for (let i = 0; i < 60; i++) {
      const phrase = turns[i % turns.length];
      const result = advanceInfraScript(state, phrase);
      expect(result.line.length).toBeGreaterThan(0);
      state = result.nextState;
    }
  });

  it("repeating the same recognized intent after it's covered cycles through delay beats rather than repeating the line", () => {
    let state = INITIAL_INFRA_SCRIPT_STATE;
    const seen = new Set<string>();
    for (let i = 0; i < 8; i++) {
      const result = advanceInfraScript(state, "How urgent is it?");
      seen.add(result.line);
      state = result.nextState;
    }
    // First response is the timing line; every repeat after that is a beat, never the timing line again.
    expect(seen.has(TIMING_LINE)).toBe(true);
    expect(seen.size).toBeGreaterThan(1);
  });
});

describe("safety: no plausible sensitive content in any scripted line", () => {
  const allLines = [INFRA_OPENING_LINE, ...ALL_TOPIC_LINES, INFRA_OTHER_FALLBACK_LINE];
  const bannedTerms = [
    "military",
    "army",
    "base",
    "ukrain",
    "russia",
    "weapon",
    "missile",
    "warhead",
    "coordinates",
    "grid reference",
  ];

  it("contains none of the disallowed sensitive-content terms", () => {
    for (const line of allLines) {
      const lower = line.toLowerCase();
      for (const term of bannedTerms) {
        expect(lower).not.toContain(term);
      }
    }
  });

  it("no scripted line contains a long digit run resembling an ID/credential", () => {
    for (const line of allLines) {
      expect(line).not.toMatch(/\d{6,}/);
    }
  });
});
