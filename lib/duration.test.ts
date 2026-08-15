import { describe, expect, it } from "vitest";
import {
  calculateDurationSeconds,
  formatDuration,
  formatDurationLong,
  formatDurationShort,
  formatTimerClock,
} from "./duration";

describe("calculateDurationSeconds", () => {
  it("returns 0 when the call hasn't started", () => {
    expect(calculateDurationSeconds(null, null)).toBe(0);
  });

  it("measures against `now` for an in-progress call", () => {
    const start = new Date("2026-08-15T10:00:00Z");
    const now = new Date("2026-08-15T10:02:14Z");
    expect(calculateDurationSeconds(start, null, now)).toBe(134);
  });

  it("measures against endedAt for a completed call, ignoring now", () => {
    const start = new Date("2026-08-15T10:00:00Z");
    const end = new Date("2026-08-15T10:04:37Z");
    const now = new Date("2026-08-15T11:00:00Z");
    expect(calculateDurationSeconds(start, end, now)).toBe(277);
  });

  it("accepts ISO string inputs", () => {
    expect(
      calculateDurationSeconds("2026-08-15T10:00:00Z", "2026-08-15T10:00:30Z")
    ).toBe(30);
  });

  it("never returns a negative duration", () => {
    const start = new Date("2026-08-15T10:00:30Z");
    const now = new Date("2026-08-15T10:00:00Z");
    expect(calculateDurationSeconds(start, null, now)).toBe(0);
  });
});

describe("formatDuration", () => {
  it("formats seconds as m:ss", () => {
    expect(formatDuration(0)).toBe("0:00");
    expect(formatDuration(5)).toBe("0:05");
    expect(formatDuration(134)).toBe("2:14");
    expect(formatDuration(3600)).toBe("60:00");
  });
});

describe("formatTimerClock", () => {
  it("zero-pads both minutes and seconds", () => {
    expect(formatTimerClock(0)).toBe("00:00");
    expect(formatTimerClock(3)).toBe("00:03");
    expect(formatTimerClock(134)).toBe("02:14");
  });
});

describe("formatDurationShort", () => {
  it("omits the minutes clause under a minute", () => {
    expect(formatDurationShort(45)).toBe("45s");
  });

  it("formats minutes and seconds", () => {
    expect(formatDurationShort(134)).toBe("2m 14s");
  });
});

describe("formatDurationLong", () => {
  it("formats sub-minute durations without a minutes clause", () => {
    expect(formatDurationLong(1)).toBe("1 second");
    expect(formatDurationLong(45)).toBe("45 seconds");
  });

  it("formats durations with minutes and seconds", () => {
    expect(formatDurationLong(277)).toBe("4 minutes 37 seconds");
    expect(formatDurationLong(61)).toBe("1 minute 1 second");
  });
});
