import { describe, expect, it } from "vitest";
import { redactSensitiveNumbers } from "./redact";

describe("redactSensitiveNumbers", () => {
  it("redacts a long digit run resembling a card number", () => {
    const input = "My card number is 4111 1111 1111 1111 okay";
    expect(redactSensitiveNumbers(input)).toBe("My card number is [REDACTED] okay");
  });

  it("redacts a 6-digit OTP-style code", () => {
    expect(redactSensitiveNumbers("the code is 482913")).toBe("the code is [REDACTED]");
  });

  it("redacts dash-separated account numbers", () => {
    expect(redactSensitiveNumbers("acct 1234-5678-90")).toBe("acct [REDACTED]");
  });

  it("leaves short numbers (e.g. an amount or a year) untouched", () => {
    expect(redactSensitiveNumbers("it happened in 2024")).toBe("it happened in 2024");
    expect(redactSensitiveNumbers("that costs 42 pounds")).toBe("that costs 42 pounds");
  });

  it("leaves ordinary conversational text untouched", () => {
    const input = "Sorry, could you repeat that? I need to find my glasses.";
    expect(redactSensitiveNumbers(input)).toBe(input);
  });
});
