import { describe, expect, it } from "vitest";
import { redactSensitiveNumbers } from "./redact.js";

describe("redactSensitiveNumbers", () => {
  it("redacts a long digit run", () => {
    expect(redactSensitiveNumbers("card 4111 1111 1111 1111 please")).toBe("card [REDACTED] please");
  });

  it("leaves ordinary short numbers alone", () => {
    expect(redactSensitiveNumbers("in 2024 it cost 42 pounds")).toBe("in 2024 it cost 42 pounds");
  });
});
