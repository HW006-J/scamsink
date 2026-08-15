import { describe, expect, it } from "vitest";
import {
  advanceInfraScript,
  INFRA_OPENING_LINE,
  INITIAL_INFRA_SCRIPT_STATE,
  NARRATIVE_PHASES,
} from "./infraScript.js";

const DELIVERY_OPTIONS_LINE =
  "Great, thank you. One second — I had the delivery information written down somewhere. Could you tell me what delivery options you have while I find it?";
const URGENCY_LINE =
  "It was definitely urgent. I think this afternoon... actually, hold on, I may be looking at tomorrow's schedule. What's the latest you could deliver today?";
const PAPERWORK_LINE =
  "Yes, I think I need an invoice. Although someone here just told me it might need a purchase order first. Could you explain what information you normally need on that?";
const ADDRESS_LINE =
  "Let me just check what address I've got on file... actually, hold on, I think this might be for a different delivery.";
const WRONG_DOCUMENT_LINE =
  "Of course. Give me one second — I've opened the wrong document. This appears to be my electricity bill.";
const REPEAT_LINE =
  "Sorry about this. I definitely had the right document open a minute ago. Could you remind me what information you needed from me?";
const NAMED_PHASE_LINES = [
  DELIVERY_OPTIONS_LINE,
  URGENCY_LINE,
  PAPERWORK_LINE,
  ADDRESS_LINE,
  WRONG_DOCUMENT_LINE,
  "Sorry, I think I've mixed up which form was for payment and which was for delivery — hold on, let me sort these out.",
  "Hold on, I need to check something with a colleague — I'll be right back.",
  "Sorry, I've confused today's date with tomorrow's again. Let me get that straight.",
  "Sorry, I think I'm looking at the wrong page now — give me a second to find the right one.",
];

describe("advanceInfraScript — bot opening line", () => {
  it("INFRA_OPENING_LINE is a fixed, non-empty string never returned by advanceInfraScript itself", () => {
    expect(INFRA_OPENING_LINE.length).toBeGreaterThan(0);
    const result = advanceInfraScript(INITIAL_INFRA_SCRIPT_STATE, "Yes, sounds good.");
    expect(result.line).not.toBe(INFRA_OPENING_LINE);
  });
});

describe("advanceInfraScript — regression: exact phrases from the real transcript", () => {
  it('"Sure. I can help with that." advances the narrative to its first beat, not a confused fallback', () => {
    const result = advanceInfraScript(INITIAL_INFRA_SCRIPT_STATE, "Sure. I can help with that.");
    expect(result.transition.intent).toBe("CAN_HELP");
    expect(result.transition.mode).toBe("narrative");
    expect(result.line).toBe(DELIVERY_OPTIONS_LINE);
    expect(result.line).not.toContain("say that again");
  });

  it('"How urgent?" gets the urgency beat directly, never the invoice/purchase-order beat', () => {
    const result = advanceInfraScript(INITIAL_INFRA_SCRIPT_STATE, "How urgent?");
    expect(result.transition.intent).toBe("DELIVERY_TIMING");
    expect(result.transition.mode).toBe("direct");
    expect(result.line).toBe(URGENCY_LINE);
    expect(result.line).not.toBe(PAPERWORK_LINE);
  });
});

describe("advanceInfraScript — intent overrides narrative order, then narrative resumes", () => {
  it("asking for the address as the very first thing gets the address beat directly", () => {
    const result = advanceInfraScript(INITIAL_INFRA_SCRIPT_STATE, "Where should I deliver them?");
    expect(result.transition.mode).toBe("direct");
    expect(result.transition.phase).toBe("ADDRESS");
    expect(result.line).toBe(ADDRESS_LINE);
  });

  it("after an out-of-order direct answer, the narrative continues from the beginning of the sequence, skipping what's covered", () => {
    const afterAddress = advanceInfraScript(INITIAL_INFRA_SCRIPT_STATE, "Where should I deliver them?");
    const next = advanceInfraScript(afterAddress.nextState, "yeah");
    // ADDRESS is already covered, so the narrative's next stop is the first
    // still-uncovered phase in NARRATIVE_PHASES order (DELIVERY_OPTIONS).
    expect(next.transition.mode).toBe("narrative");
    expect(next.transition.phase).toBe("DELIVERY_OPTIONS");
    expect(next.line).toBe(DELIVERY_OPTIONS_LINE);
  });

  it("asking about payment before anything else still gets the paperwork line", () => {
    const result = advanceInfraScript(INITIAL_INFRA_SCRIPT_STATE, "How are you paying for this?");
    expect(result.line).toBe(PAPERWORK_LINE);
  });

  it("re-asking a question already answered on demand doesn't repeat verbatim — the narrative continues instead", () => {
    const first = advanceInfraScript(INITIAL_INFRA_SCRIPT_STATE, "How urgent is it?");
    const second = advanceInfraScript(first.nextState, "How urgent is it again?");
    expect(second.line).not.toBe(URGENCY_LINE);
    expect(second.transition.mode).toBe("narrative");
  });
});

describe("advanceInfraScript — vague affirmatives advance the story", () => {
  for (const phrase of ["yeah", "okay", "sure", "right", "yep", "ok"]) {
    it(`"${phrase}" is treated as permission to continue, not a topic answer`, () => {
      const result = advanceInfraScript(INITIAL_INFRA_SCRIPT_STATE, phrase);
      expect(result.transition.intent).toBe("CAN_HELP");
      expect(result.transition.mode).toBe("narrative");
      expect(result.line).toBe(DELIVERY_OPTIONS_LINE);
    });
  }

  it("a vague affirmative later in the call advances to the next uncovered beat, not back to the start", () => {
    const first = advanceInfraScript(INITIAL_INFRA_SCRIPT_STATE, "sure");
    const second = advanceInfraScript(first.nextState, "okay");
    expect(second.line).toBe(URGENCY_LINE);
  });
});

describe("advanceInfraScript — unintelligible/unrelated input still leads to useful progression", () => {
  it("unintelligible garbage still advances the narrative instead of asking to repeat", () => {
    const result = advanceInfraScript(INITIAL_INFRA_SCRIPT_STATE, "asdkj qwoe mglbh");
    expect(result.transition.intent).toBe("OTHER");
    expect(result.transition.mode).toBe("narrative");
    expect(result.line).toBe(DELIVERY_OPTIONS_LINE);
  });

  it("empty input (used for silence continuations) also advances the narrative", () => {
    const result = advanceInfraScript(INITIAL_INFRA_SCRIPT_STATE, "");
    expect(result.transition.intent).toBe("OTHER");
    expect(result.line).toBe(DELIVERY_OPTIONS_LINE);
  });

  it("something entirely unrelated still moves the story forward rather than getting stuck", () => {
    const first = advanceInfraScript(INITIAL_INFRA_SCRIPT_STATE, "so how's the weather where you are?");
    const second = advanceInfraScript(first.nextState, "nice, anyway, go on");
    expect(second.transition.mode).toBe("narrative");
    expect(second.line).not.toBe(first.line);
  });

  it("unrelated input never gets permanently stuck: many consecutive off-topic turns still keep producing new beats", () => {
    let state = INITIAL_INFRA_SCRIPT_STATE;
    const seenLines = new Set<string>();
    for (let i = 0; i < 12; i++) {
      const result = advanceInfraScript(state, `totally unrelated remark number ${i}`);
      seenLines.add(result.line);
      state = result.nextState;
    }
    expect(seenLines.size).toBeGreaterThan(1);
  });
});

describe("advanceInfraScript — CONFUSED/REPEAT_REQUEST", () => {
  it('a bare "What?" restates without advancing the narrative', () => {
    const result = advanceInfraScript(INITIAL_INFRA_SCRIPT_STATE, "What?");
    expect(result.transition.intent).toBe("CONFUSED");
    expect(result.transition.mode).toBe("clarify");
    expect(result.line).toBe(REPEAT_LINE);
    expect(result.nextState.coveredPhases.size).toBe(0);
  });

  it("persistent confusion eventually continues the story instead of restating forever", () => {
    let state = INITIAL_INFRA_SCRIPT_STATE;
    const modes: string[] = [];
    for (let i = 0; i < 5; i++) {
      const result = advanceInfraScript(state, "sorry, what?");
      modes.push(result.transition.mode);
      state = result.nextState;
    }
    // Never gets stuck saying "sorry, what?" indefinitely — narrative
    // progress happens at least once within a handful of repeated turns.
    expect(modes).toContain("narrative");
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

  it("conversation can continue for many turns (30+) without exhausting scripted material", () => {
    let state = INITIAL_INFRA_SCRIPT_STATE;
    const turns = [
      "sure",
      "how urgent is it?",
      "random babble",
      "",
      "do you need an invoice?",
      "what's your address?",
      "sorry, what?",
      "yeah",
      "another unrelated thing",
      "okay go on",
    ];
    for (let i = 0; i < 40; i++) {
      const result = advanceInfraScript(state, turns[i % turns.length]);
      expect(result.line.length).toBeGreaterThan(0);
      state = result.nextState;
    }
  });

  it("once every named phase is covered, EXTENDED_DELAY cycles through varied lines forever", () => {
    let state = INITIAL_INFRA_SCRIPT_STATE;
    // Cover every named phase via generic "continue" turns.
    for (let i = 0; i < NARRATIVE_PHASES.length - 1; i++) {
      const result = advanceInfraScript(state, "yeah");
      state = result.nextState;
    }
    const seen = new Set<string>();
    for (let i = 0; i < 12; i++) {
      const result = advanceInfraScript(state, "yeah");
      expect(result.transition.phase).toBe("EXTENDED_DELAY");
      seen.add(result.line);
      state = result.nextState;
    }
    expect(seen.size).toBeGreaterThan(1);
    for (const line of seen) expect(NAMED_PHASE_LINES).not.toContain(line);
  });
});

describe("safety: no plausible sensitive content in any scripted line", () => {
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
    const allLines = [INFRA_OPENING_LINE, ...NAMED_PHASE_LINES, REPEAT_LINE];
    for (const line of allLines) {
      const lower = line.toLowerCase();
      for (const term of bannedTerms) {
        expect(lower).not.toContain(term);
      }
    }
  });

  it("no scripted line contains a long digit run resembling an ID/credential", () => {
    const allLines = [INFRA_OPENING_LINE, ...NAMED_PHASE_LINES, REPEAT_LINE];
    for (const line of allLines) {
      expect(line).not.toMatch(/\d{6,}/);
    }
  });
});
