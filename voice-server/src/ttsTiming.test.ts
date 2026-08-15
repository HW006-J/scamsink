import { describe, expect, it } from "vitest";
import { estimatePlaybackMs, estimateProactiveDelayMs, HUMAN_RESPONSE_GRACE_MS } from "./ttsTiming.js";

describe("estimatePlaybackMs", () => {
  it("scales with word count", () => {
    const short = estimatePlaybackMs("Hello there.");
    const long = estimatePlaybackMs(
      "It was definitely urgent. I think this afternoon... actually, hold on, I may be looking at tomorrow's schedule. What's the latest you could deliver today?",
    );
    expect(long).toBeGreaterThan(short);
  });

  it("applies a minimum floor for very short text", () => {
    expect(estimatePlaybackMs("Hi.")).toBeGreaterThanOrEqual(1_500);
  });

  it("estimates a ~25-word line at roughly 10-14 real seconds (conservative, not instant)", () => {
    const line =
      "It was definitely urgent. I think this afternoon... actually, hold on, I may be looking at tomorrow's schedule. What's the latest you could deliver today?";
    const ms = estimatePlaybackMs(line);
    expect(ms).toBeGreaterThan(9_000);
    expect(ms).toBeLessThan(16_000);
  });

  it("is deterministic for the same input", () => {
    const line = "Great, thank you. One second — I had the delivery information written down somewhere.";
    expect(estimatePlaybackMs(line)).toBe(estimatePlaybackMs(line));
  });

  it("never returns zero or negative for empty input", () => {
    expect(estimatePlaybackMs("")).toBeGreaterThan(0);
  });
});

describe("estimateProactiveDelayMs", () => {
  it("equals estimated playback plus the human response grace period", () => {
    const line = "Sorry about this. I definitely had the right document open a minute ago.";
    expect(estimateProactiveDelayMs(line)).toBe(estimatePlaybackMs(line) + HUMAN_RESPONSE_GRACE_MS);
  });

  it("HUMAN_RESPONSE_GRACE_MS is approximately 5 seconds", () => {
    expect(HUMAN_RESPONSE_GRACE_MS).toBe(5_000);
  });

  it("matches the worked example from the spec: ~6.5s playback + 5s grace ~= 11.5s", () => {
    // Construct a line whose word count lands close to a ~6.5s estimate to
    // sanity-check the model against the example given, without asserting
    // an exact global constant.
    const words = Array.from({ length: 13 }, (_, i) => `word${i}`).join(" ");
    const playback = estimatePlaybackMs(words);
    expect(playback).toBeGreaterThan(5_500);
    expect(playback).toBeLessThan(8_000);
    expect(estimateProactiveDelayMs(words)).toBe(playback + 5_000);
  });
});
