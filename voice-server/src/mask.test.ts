import { describe, expect, it } from "vitest";
import { maskPhoneNumber } from "./mask.js";

describe("maskPhoneNumber", () => {
  it("masks a UK E.164 number", () => {
    expect(maskPhoneNumber("+447911123456")).toBe("+44 **** **** 56");
  });

  it("returns UNKNOWN for missing input", () => {
    expect(maskPhoneNumber(null)).toBe("UNKNOWN");
    expect(maskPhoneNumber(undefined)).toBe("UNKNOWN");
  });
});
