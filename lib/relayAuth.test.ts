import { createHmac, timingSafeEqual } from "node:crypto";
import { describe, expect, it } from "vitest";
import { generateRelayToken } from "./relayAuth";

// Mirrors voice-server/src/auth.ts#verifyRelayToken exactly — the two sides
// can't share code across deploy targets, so this test pins the contract
// both implementations must independently satisfy.
function verify(callSid: string, token: string, secret: string): boolean {
  const [expiresAtRaw, signatureHex] = token.split(".");
  if (!expiresAtRaw || !signatureHex) return false;
  const expiresAt = Number(expiresAtRaw);
  if (!Number.isFinite(expiresAt) || Date.now() > expiresAt) return false;
  const expected = createHmac("sha256", secret).update(`${callSid}.${expiresAtRaw}`).digest("hex");
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(signatureHex, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

describe("relay token", () => {
  const secret = "test-shared-secret-please-ignore";

  it("verifies a freshly generated token for the same call sid", () => {
    const token = generateRelayToken("CAxxxxx", secret);
    expect(verify("CAxxxxx", token, secret)).toBe(true);
  });

  it("rejects a token generated for a different call sid", () => {
    const token = generateRelayToken("CAxxxxx", secret);
    expect(verify("CAyyyyy", token, secret)).toBe(false);
  });

  it("rejects a token signed with the wrong secret", () => {
    const token = generateRelayToken("CAxxxxx", secret);
    expect(verify("CAxxxxx", token, "wrong-secret")).toBe(false);
  });

  it("rejects an expired token", () => {
    const token = generateRelayToken("CAxxxxx", secret, -1000);
    expect(verify("CAxxxxx", token, secret)).toBe(false);
  });

  it("rejects a malformed token", () => {
    expect(verify("CAxxxxx", "not-a-real-token", secret)).toBe(false);
    expect(verify("CAxxxxx", "", secret)).toBe(false);
  });
});
