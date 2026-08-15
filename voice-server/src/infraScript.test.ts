import { describe, expect, it } from "vitest";
import {
  advanceInfraScript,
  INFRA_OPENING_LINE,
  INFRA_SCRIPT_FALLBACK_LINE,
  INITIAL_INFRA_SCRIPT_STATE,
} from "./infraScript.js";

const CORE_LINE_1 =
  "Great, thank you. One second — I had the delivery information written down somewhere. Could you tell me what delivery options you have while I find it?";
const CORE_LINE_2 =
  "It was definitely urgent. I think this afternoon... actually, hold on, I may be looking at tomorrow's schedule. What's the latest you could deliver today?";
const CORE_LINE_3 =
  "Yes, I think I need an invoice. Although someone here just told me it might need a purchase order first. Could you explain what information you normally need on that?";
const CORE_LINE_4 =
  "Of course. Give me one second — I've opened the wrong document. This appears to be my electricity bill.";
const CORE_LINE_5 =
  "Sorry about this. I definitely had the right document open a minute ago. Could you remind me what information you needed from me?";

describe("advanceInfraScript — bot opening line", () => {
  it("INFRA_OPENING_LINE is a fixed, non-empty string never returned by advanceInfraScript itself", () => {
    expect(INFRA_OPENING_LINE.length).toBeGreaterThan(0);
    const result = advanceInfraScript(INITIAL_INFRA_SCRIPT_STATE, "Yes, sounds good.");
    expect(result.line).not.toBe(INFRA_OPENING_LINE);
  });

  it("initial state starts at index 1 — the opening line is assumed already spoken", () => {
    expect(INITIAL_INFRA_SCRIPT_STATE.index).toBe(1);
  });
});

describe("advanceInfraScript — each scripted state", () => {
  it("STATE 1: an affirmative reply advances to the exact line 1 response", () => {
    const result = advanceInfraScript(INITIAL_INFRA_SCRIPT_STATE, "Yes, sure, I can help with that.");
    expect(result.line).toBe(CORE_LINE_1);
    expect(result.nextState).toEqual({ index: 2, fallbackStreak: 0 });
  });

  it("STATE 2: asking about timing advances to the exact line 2 response", () => {
    const result = advanceInfraScript({ index: 2, fallbackStreak: 0 }, "What time do you need them?");
    expect(result.line).toBe(CORE_LINE_2);
    expect(result.nextState.index).toBe(3);
  });

  it("STATE 3: asking about invoice/payment advances to the exact line 3 response", () => {
    const result = advanceInfraScript({ index: 3, fallbackStreak: 0 }, "Do you need an invoice for this?");
    expect(result.line).toBe(CORE_LINE_3);
    expect(result.nextState.index).toBe(4);
  });

  it("STATE 4: asking for delivery details advances to the exact line 4 response", () => {
    const result = advanceInfraScript({ index: 4, fallbackStreak: 0 }, "What's the delivery address?");
    expect(result.line).toBe(CORE_LINE_4);
    expect(result.nextState.index).toBe(5);
  });

  it("STATE 5: continued engagement advances to the exact line 5 response", () => {
    const result = advanceInfraScript({ index: 5, fallbackStreak: 0 }, "Okay, go on.");
    expect(result.line).toBe(CORE_LINE_5);
    expect(result.nextState.index).toBe(6);
  });

  it("beyond state 5, cycles through varied delay beats rather than repeating earlier lines", () => {
    let state = { index: 6, fallbackStreak: 0 };
    const seen: string[] = [];
    const coreLines = [CORE_LINE_1, CORE_LINE_2, CORE_LINE_3, CORE_LINE_4, CORE_LINE_5];
    for (let i = 0; i < 6; i++) {
      const result = advanceInfraScript(state, "still there, go on");
      seen.push(result.line);
      state = result.nextState;
    }
    for (const line of seen) expect(coreLines).not.toContain(line);
    expect(new Set(seen).size).toBe(6); // 6 distinct delay beats before repeating
  });

  it("beats are varied, not a repeated 'one second' filler", () => {
    let state = { index: 6, fallbackStreak: 0 };
    const seen: string[] = [];
    for (let i = 0; i < 6; i++) {
      const result = advanceInfraScript(state, "go on");
      seen.push(result.line.toLowerCase());
      state = result.nextState;
    }
    const trivialCount = seen.filter((line) => line === "one second").length;
    expect(trivialCount).toBe(0);
    expect(new Set(seen).size).toBeGreaterThan(1);
  });
});

describe("advanceInfraScript — paraphrased human responses", () => {
  it("accepts 'sounds good' for state 1", () => {
    const result = advanceInfraScript(INITIAL_INFRA_SCRIPT_STATE, "Sounds good, where should I deliver them?");
    expect(result.transition.matched).toBe(true);
  });

  it("accepts 'how urgent is it' for state 2", () => {
    const result = advanceInfraScript({ index: 2, fallbackStreak: 0 }, "How urgent is it exactly?");
    expect(result.transition.matched).toBe(true);
  });

  it("accepts 'purchase order' for state 3", () => {
    const result = advanceInfraScript({ index: 3, fallbackStreak: 0 }, "I'll need a purchase order number.");
    expect(result.transition.matched).toBe(true);
  });

  it("accepts 'company information' for state 4", () => {
    const result = advanceInfraScript({ index: 4, fallbackStreak: 0 }, "Can I get your company details?");
    expect(result.transition.matched).toBe(true);
  });

  it("is case-insensitive and punctuation-tolerant", () => {
    const result = advanceInfraScript({ index: 3, fallbackStreak: 0 }, "INVOICE??");
    expect(result.transition.matched).toBe(true);
  });
});

describe("advanceInfraScript — unexpected human utterance", () => {
  it("replies with the fallback line and stays at the same state on the first mismatch", () => {
    const result = advanceInfraScript({ index: 3, fallbackStreak: 0 }, "What's the weather like today?");
    expect(result.line).toBe(INFRA_SCRIPT_FALLBACK_LINE);
    expect(result.nextState).toEqual({ index: 3, fallbackStreak: 1 });
    expect(result.transition.matched).toBe(false);
  });

  it("force-advances on a second consecutive mismatch, never getting stuck", () => {
    const first = advanceInfraScript({ index: 3, fallbackStreak: 0 }, "unrelated nonsense");
    const second = advanceInfraScript(first.nextState, "still unrelated");
    expect(second.transition.matched).toBe(false);
    expect(second.nextState.index).toBe(4);
    expect(second.nextState.fallbackStreak).toBe(0);
  });
});

describe("advanceInfraScript — indefinite continuation / no-response prevention", () => {
  it("never returns an empty line, even for empty input", () => {
    const result = advanceInfraScript(INITIAL_INFRA_SCRIPT_STATE, "");
    expect(result.line.length).toBeGreaterThan(0);
  });

  it("never throws for garbage input or an out-of-range state", () => {
    expect(() => advanceInfraScript({ index: 500, fallbackStreak: 0 }, "🚁🚁")).not.toThrow();
  });

  it("always returns a non-empty line across a long simulated conversation", () => {
    let state = INITIAL_INFRA_SCRIPT_STATE;
    for (let i = 0; i < 60; i++) {
      const result = advanceInfraScript(state, `human turn ${i}`);
      expect(result.line.length).toBeGreaterThan(0);
      state = result.nextState;
    }
  });
});

describe("safety: no plausible sensitive content in any scripted line", () => {
  const allLines = [
    INFRA_OPENING_LINE,
    CORE_LINE_1,
    CORE_LINE_2,
    CORE_LINE_3,
    CORE_LINE_4,
    CORE_LINE_5,
  ];
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
