import { describe, expect, it } from "vitest";
import { advanceDemoScript, DEMO_SCRIPT_FALLBACK_LINE, INITIAL_DEMO_SCRIPT_STATE } from "./demoScript.js";

const CORE_LINE = [
  "Oh wow, really? Yeah, one second, I'll go and get it.",
  "Almost — I just dropped it down the side of the sofa. Give me one second, I can see it.",
  "Okay, I've got it. It's... one... three... one...",
  "Oh, sorry! That's the price of the table I bought this morning. I'm looking at the receipt. Hold on, the card must be underneath it somewhere.",
  "Right, I've found another card now. Wait... no, this one's my library card. Sorry, give me another second.",
];

describe("advanceDemoScript — each scripted state", () => {
  it("STATE 0: any opening pitch advances to the exact line 0 response", () => {
    const result = advanceDemoScript(INITIAL_DEMO_SCRIPT_STATE, "Hi, I'm calling from Microsoft, you've won £1000, do you have your credit card?");
    expect(result.line).toBe(CORE_LINE[0]);
    expect(result.nextState).toEqual({ index: 1, fallbackStreak: 0 });
    expect(result.transition).toEqual({ fromIndex: 0, toIndex: 1, matched: true });
  });

  it("STATE 1: 'do you have it' advances to the exact line 1 response", () => {
    const state = { index: 1, fallbackStreak: 0 };
    const result = advanceDemoScript(state, "Do you have it?");
    expect(result.line).toBe(CORE_LINE[1]);
    expect(result.nextState.index).toBe(2);
  });

  it("STATE 2: asking for the card number advances to the exact line 2 response", () => {
    const state = { index: 2, fallbackStreak: 0 };
    const result = advanceDemoScript(state, "What's your card number?");
    expect(result.line).toBe(CORE_LINE[2]);
    expect(result.nextState.index).toBe(3);
  });

  it("STATE 3: a confused follow-up advances to the exact line 3 response", () => {
    const state = { index: 3, fallbackStreak: 0 };
    const result = advanceDemoScript(state, "What?");
    expect(result.line).toBe(CORE_LINE[3]);
    expect(result.nextState.index).toBe(4);
  });

  it("STATE 4: continued engagement advances to the exact line 4 response", () => {
    const state = { index: 4, fallbackStreak: 0 };
    const result = advanceDemoScript(state, "Come on, read me the number.");
    expect(result.line).toBe(CORE_LINE[4]);
    expect(result.nextState.index).toBe(5);
  });

  it("beyond state 4, cycles through the delay beats rather than repeating the opening jokes", () => {
    let state = { index: 5, fallbackStreak: 0 };
    const seen: string[] = [];
    for (let i = 0; i < 6; i++) {
      const result = advanceDemoScript(state, "still there?");
      seen.push(result.line);
      state = result.nextState;
    }
    // Never repeats a CORE_LINE, and cycles among exactly 3 distinct beats.
    for (const line of seen) expect(CORE_LINE).not.toContain(line);
    expect(new Set(seen).size).toBe(3);
    expect(seen[0]).toBe(seen[3]); // cycle length 3
  });
});

describe("advanceDemoScript — paraphrased caller phrases", () => {
  it("accepts 'have you got the card?' for state 1", () => {
    const result = advanceDemoScript({ index: 1, fallbackStreak: 0 }, "Have you got the card?");
    expect(result.transition.matched).toBe(true);
    expect(result.nextState.index).toBe(2);
  });

  it("accepts 'have you found it' for state 1", () => {
    const result = advanceDemoScript({ index: 1, fallbackStreak: 0 }, "Have you found it yet, sir?");
    expect(result.transition.matched).toBe(true);
  });

  it("accepts 'tell me the number' for state 2", () => {
    const result = advanceDemoScript({ index: 2, fallbackStreak: 0 }, "Okay, tell me the number now.");
    expect(result.transition.matched).toBe(true);
  });

  it("accepts 'sorry, come again?' for state 3", () => {
    const result = advanceDemoScript({ index: 3, fallbackStreak: 0 }, "Sorry, come again?");
    expect(result.transition.matched).toBe(true);
  });

  it("is case-insensitive and punctuation-tolerant", () => {
    const result = advanceDemoScript({ index: 1, fallbackStreak: 0 }, "HAVE YOU GOT IT???");
    expect(result.transition.matched).toBe(true);
  });
});

describe("advanceDemoScript — unexpected caller utterance", () => {
  it("replies with the fallback line and stays at the same state on the first mismatch", () => {
    const result = advanceDemoScript({ index: 2, fallbackStreak: 0 }, "What's the weather like there?");
    expect(result.line).toBe(DEMO_SCRIPT_FALLBACK_LINE);
    expect(result.nextState).toEqual({ index: 2, fallbackStreak: 1 });
    expect(result.transition.matched).toBe(false);
    expect(result.transition.toIndex).toBe(2);
  });

  it("force-advances on a second consecutive mismatch, never getting stuck", () => {
    const first = advanceDemoScript({ index: 2, fallbackStreak: 0 }, "unrelated nonsense");
    expect(first.nextState.fallbackStreak).toBe(1);

    // Forced progress still speaks state 2's own line (as if the caller had
    // matched it) — it just refuses to stay stuck at index 2 a third time.
    const second = advanceDemoScript(first.nextState, "still unrelated nonsense");
    expect(second.transition.matched).toBe(false);
    expect(second.nextState.index).toBe(3);
    expect(second.nextState.fallbackStreak).toBe(0);
    expect(second.line).toBe(CORE_LINE[2]);
  });
});

describe("advanceDemoScript — no-response prevention", () => {
  it("never returns an empty line, even for empty caller text", () => {
    const result = advanceDemoScript(INITIAL_DEMO_SCRIPT_STATE, "");
    expect(result.line.length).toBeGreaterThan(0);
  });

  it("never throws for garbage/unusual input", () => {
    expect(() => advanceDemoScript({ index: 3, fallbackStreak: 1 }, "🎉🎉🎉 \n\t")).not.toThrow();
    expect(() => advanceDemoScript({ index: 999, fallbackStreak: 0 }, "x")).not.toThrow();
  });

  it("always returns a non-empty line across a long simulated call", () => {
    let state = INITIAL_DEMO_SCRIPT_STATE;
    for (let i = 0; i < 50; i++) {
      const result = advanceDemoScript(state, `turn ${i}`);
      expect(result.line.length).toBeGreaterThan(0);
      state = result.nextState;
    }
  });
});

describe("advanceDemoScript — state persistence", () => {
  it("threading nextState through successive calls advances the conversation correctly", () => {
    let state = INITIAL_DEMO_SCRIPT_STATE;
    const lines: string[] = [];
    const utterances = [
      "Hi, this is Microsoft calling, you've won a prize, do you have your card?",
      "Have you got it?",
      "Read me the card number.",
      "Sorry, what?",
    ];
    for (const utterance of utterances) {
      const result = advanceDemoScript(state, utterance);
      lines.push(result.line);
      state = result.nextState;
    }
    expect(lines).toEqual(CORE_LINE.slice(0, 4));
    expect(state.index).toBe(4);
  });
});

describe("safety: no plausible credential-like fragments in any scripted line", () => {
  it("no scripted line contains a run of 10+ consecutive digits", () => {
    for (const line of CORE_LINE) {
      expect(line).not.toMatch(/\d{10,}/);
    }
  });
});
