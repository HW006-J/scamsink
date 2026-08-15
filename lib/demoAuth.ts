import { createHash, timingSafeEqual } from "node:crypto";

const DEMO_SECRET_HEADER = "x-demo-operator-secret";

/** Constant-time string compare via fixed-length digests, so mismatched lengths don't leak timing. */
function safeEqual(a: string, b: string): boolean {
  const digestA = createHash("sha256").update(a).digest();
  const digestB = createHash("sha256").update(b).digest();
  return timingSafeEqual(digestA, digestB);
}

/**
 * Gates the demo click-to-call route. The dashboard prompts the operator for
 * this passphrase once (stored client-side in sessionStorage) and sends it
 * as a header — it never appears in any shipped JS bundle. This is
 * deliberately lightweight: the real cost/abuse protection is that the
 * destination number is a fixed server-side env var, never client input.
 */
export function isAuthorizedDemoOperator(request: Request, expectedSecret: string): boolean {
  const provided = request.headers.get(DEMO_SECRET_HEADER);
  if (!provided) return false;
  return safeEqual(provided, expectedSecret);
}

export { DEMO_SECRET_HEADER };
