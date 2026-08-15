import { describe, expect, it } from "vitest";
import { maskPhoneNumber } from "./mask";

describe("maskPhoneNumber", () => {
  it("masks a UK E.164 number, keeping a prefix and last two digits", () => {
    expect(maskPhoneNumber("+447911123456")).toBe("+44 **** **** 56");
  });

  it("masks a US E.164 number", () => {
    expect(maskPhoneNumber("+14155552671")).toBe("+14 **** **** 71");
  });

  it("returns UNKNOWN for null or empty input", () => {
    expect(maskPhoneNumber(null)).toBe("UNKNOWN");
    expect(maskPhoneNumber(undefined)).toBe("UNKNOWN");
    expect(maskPhoneNumber("")).toBe("UNKNOWN");
  });

  it("never contains the full original digit sequence", () => {
    const input = "+447911123456";
    const digits = input.replace(/\D/g, "");
    const masked = maskPhoneNumber(input);
    expect(masked.replace(/\D/g, "")).not.toBe(digits);
  });

  it("handles short/malformed numbers without throwing", () => {
    expect(() => maskPhoneNumber("123")).not.toThrow();
    expect(maskPhoneNumber("12")).toBe("****");
  });
});
