import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyRelayToken } from "./auth.js";

// Mirrors lib/relayAuth.ts#generateRelayToken exactly — see that file's test
// for the reciprocal contract check on the Next.js side.
function generate(callSid: string, secret: string, ttlMs = 5 * 60 * 1000): string {
  const expiresAt = Date.now() + ttlMs;
  const signature = createHmac("sha256", secret).update(`${callSid}.${expiresAt}`).digest("hex");
  return `${expiresAt}.${signature}`;
}

describe("verifyRelayToken", () => {
  const secret = "test-shared-secret-please-ignore";

  it("accepts a valid, unexpired token for the matching call sid", () => {
    const token = generate("CAxxxxx", secret);
    expect(verifyRelayToken("CAxxxxx", token, secret)).toBe(true);
  });

  it("rejects a token for a different call sid", () => {
    const token = generate("CAxxxxx", secret);
    expect(verifyRelayToken("CAyyyyy", token, secret)).toBe(false);
  });

  it("rejects a token signed with a different secret", () => {
    const token = generate("CAxxxxx", secret);
    expect(verifyRelayToken("CAxxxxx", token, "other-secret")).toBe(false);
  });

  it("rejects an expired token", () => {
    const token = generate("CAxxxxx", secret, -1000);
    expect(verifyRelayToken("CAxxxxx", token, secret)).toBe(false);
  });

  it("rejects malformed tokens without throwing", () => {
    expect(verifyRelayToken("CAxxxxx", "garbage", secret)).toBe(false);
    expect(verifyRelayToken("CAxxxxx", "", secret)).toBe(false);
    expect(() => verifyRelayToken("CAxxxxx", "a.b.c", secret)).not.toThrow();
  });
});
