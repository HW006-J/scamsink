import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * ConversationRelay's WebSocket URL has no native Twilio request-signing
 * (unlike the HTTP voice webhook's X-Twilio-Signature). Instead, the Next.js
 * /api/twilio/voice route embeds a short-lived HMAC token for the CallSid in
 * the wss:// URL it hands to Twilio; this verifies that token on connect so
 * only URLs we ourselves generated (for that specific call) are accepted.
 * Both sides must share VOICE_SERVER_SHARED_SECRET.
 */
export function verifyRelayToken(callSid: string, token: string, secret: string): boolean {
  const parts = token.split(".");
  if (parts.length !== 2) return false;
  const [expiresAtRaw, signatureHex] = parts;

  const expiresAt = Number(expiresAtRaw);
  if (!Number.isFinite(expiresAt) || Date.now() > expiresAt) return false;

  const expectedSignature = createHmac("sha256", secret).update(`${callSid}.${expiresAtRaw}`).digest("hex");

  const expected = Buffer.from(expectedSignature, "hex");
  const actual = Buffer.from(signatureHex, "hex");
  if (expected.length !== actual.length) return false;

  return timingSafeEqual(expected, actual);
}
