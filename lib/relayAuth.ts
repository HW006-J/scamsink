import { createHmac } from "node:crypto";

/**
 * Generates the short-lived HMAC token embedded in the ConversationRelay
 * wss:// URL, proving to the voice-server that this connection request for
 * a given CallSid originated from our own /api/twilio/voice webhook. The
 * voice-server's verifyRelayToken (voice-server/src/auth.ts) must use the
 * same algorithm and shared secret.
 */
export function generateRelayToken(callSid: string, secret: string, ttlMs = 5 * 60 * 1000): string {
  const expiresAt = Date.now() + ttlMs;
  const signature = createHmac("sha256", secret).update(`${callSid}.${expiresAt}`).digest("hex");
  return `${expiresAt}.${signature}`;
}
