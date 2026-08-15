import twilio from "twilio";
import { getServerEnv } from "./env";

export class InvalidTwilioSignatureError extends Error {
  constructor() {
    super("Invalid Twilio request signature");
    this.name = "InvalidTwilioSignatureError";
  }
}

/**
 * Parses a Twilio webhook's form-encoded body and verifies X-Twilio-Signature
 * against the exact public URL Twilio computed it against. The URL is built
 * from PUBLIC_APP_URL (never request.url / the Host header) so this can't be
 * bypassed by a spoofed or proxy-rewritten Host.
 */
export async function readVerifiedTwilioRequest(
  request: Request,
  pathname: string
): Promise<Record<string, string>> {
  const env = getServerEnv();
  const bodyText = await request.text();
  const params = Object.fromEntries(new URLSearchParams(bodyText));

  const signature = request.headers.get("X-Twilio-Signature");
  const url = new URL(pathname, env.PUBLIC_APP_URL).toString();

  if (!signature || !twilio.validateRequest(env.TWILIO_AUTH_TOKEN, signature, url, params)) {
    throw new InvalidTwilioSignatureError();
  }

  return params;
}
