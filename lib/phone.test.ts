import { describe, expect, it } from "vitest";
import { isAllowedDemoDestination, normalizePhoneNumberToE164, parseAllowedPhoneNumbers } from "./phone";

describe("normalizePhoneNumberToE164", () => {
  it("expands a UK-style leading-0 local number", () => {
    expect(normalizePhoneNumberToE164("07940757160")).toBe("+447940757160");
  });

  it("passes through an already-E.164 number unchanged", () => {
    expect(normalizePhoneNumberToE164("+447940757160")).toBe("+447940757160");
  });

  it("strips formatting characters from a + number", () => {
    expect(normalizePhoneNumberToE164("+44 7940 757160")).toBe("+447940757160");
    expect(normalizePhoneNumberToE164("+1 (218) 429-3208")).toBe("+12184293208");
  });

  it("strips formatting characters from a leading-0 number", () => {
    expect(normalizePhoneNumberToE164("07940 757 160")).toBe("+447940757160");
  });

  it("rejects a number with no + and no leading 0 (ambiguous country code)", () => {
    expect(normalizePhoneNumberToE164("7940757160")).toBeNull();
  });

  it("rejects empty or whitespace-only input", () => {
    expect(normalizePhoneNumberToE164("")).toBeNull();
    expect(normalizePhoneNumberToE164("   ")).toBeNull();
  });

  it("rejects garbage input", () => {
    expect(normalizePhoneNumberToE164("not a number")).toBeNull();
  });

  it("rejects a too-short number", () => {
    expect(normalizePhoneNumberToE164("+44123")).toBeNull();
  });
});

describe("parseAllowedPhoneNumbers", () => {
  it("parses a comma-separated list into normalized numbers", () => {
    expect(parseAllowedPhoneNumbers("+447940757160,07700900000")).toEqual([
      "+447940757160",
      "+447700900000",
    ]);
  });

  it("returns an empty array for undefined or empty input", () => {
    expect(parseAllowedPhoneNumbers(undefined)).toEqual([]);
    expect(parseAllowedPhoneNumbers("")).toEqual([]);
  });

  it("drops unparseable entries rather than throwing", () => {
    expect(parseAllowedPhoneNumbers("+447940757160,garbage,07700900000")).toEqual([
      "+447940757160",
      "+447700900000",
    ]);
  });
});

describe("isAllowedDemoDestination", () => {
  it("accepts a number present in the allowlist", () => {
    expect(isAllowedDemoDestination("+447940757160", ["+447940757160"])).toBe(true);
  });

  it("rejects a number not present in the allowlist", () => {
    expect(isAllowedDemoDestination("+447700900000", ["+447940757160"])).toBe(false);
  });

  it("rejects everything against an empty allowlist", () => {
    expect(isAllowedDemoDestination("+447940757160", [])).toBe(false);
  });
});
