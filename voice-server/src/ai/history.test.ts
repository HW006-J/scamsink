import { describe, expect, it } from "vitest";
import { boundHistory, MAX_HISTORY_MESSAGES } from "./history.js";
import type { ConversationTurn } from "./provider.js";

function turn(i: number): ConversationTurn {
  return { role: i % 2 === 0 ? "user" : "assistant", content: `turn ${i}` };
}

describe("boundHistory", () => {
  it("returns the history unchanged when under the limit", () => {
    const history = Array.from({ length: 5 }, (_, i) => turn(i));
    expect(boundHistory(history)).toEqual(history);
  });

  it("returns the history unchanged when exactly at the limit", () => {
    const history = Array.from({ length: MAX_HISTORY_MESSAGES }, (_, i) => turn(i));
    expect(boundHistory(history)).toEqual(history);
  });

  it("keeps only the most recent messages when over the limit", () => {
    const history = Array.from({ length: MAX_HISTORY_MESSAGES + 10 }, (_, i) => turn(i));
    const bounded = boundHistory(history);

    expect(bounded).toHaveLength(MAX_HISTORY_MESSAGES);
    expect(bounded[0]).toEqual(turn(10));
    expect(bounded[bounded.length - 1]).toEqual(turn(MAX_HISTORY_MESSAGES + 9));
  });

  it("respects a custom max", () => {
    const history = Array.from({ length: 8 }, (_, i) => turn(i));
    const bounded = boundHistory(history, 3);

    expect(bounded).toHaveLength(3);
    expect(bounded[0]).toEqual(turn(5));
  });

  it("never mutates the input array", () => {
    const history = Array.from({ length: MAX_HISTORY_MESSAGES + 5 }, (_, i) => turn(i));
    const originalLength = history.length;

    boundHistory(history);

    expect(history).toHaveLength(originalLength);
  });
});
