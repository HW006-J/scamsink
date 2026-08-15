import twilio from "twilio";
import { NextResponse } from "next/server";
import { createCall, getActiveCall, getMostRecentDemoCallCreatedAt } from "@/lib/calls";
import { isAuthorizedDemoOperator } from "@/lib/demoAuth";
import { getServerEnv } from "@/lib/env";
import { maskPhoneNumber } from "@/lib/mask";
import { isAllowedDemoDestination, normalizePhoneNumberToE164, parseAllowedPhoneNumbers } from "@/lib/phone";
import { DEMO_MODES, PERSONA_DEFAULT, type DemoMode } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Outbound calls cost money and can be abused, so creation is throttled
// regardless of how the previous call ended (also blocks double-click spam).
const RATE_LIMIT_COOLDOWN_SECONDS = 30;

export async function POST(request: Request) {
  const env = getServerEnv();

  if (!env.DEMO_PHONE_NUMBER || !env.DEMO_OPERATOR_SECRET) {
    return NextResponse.json(
      { error: "DEMO_NOT_CONFIGURED", message: "Demo call mode isn't configured on this deployment." },
      { status: 501 },
    );
  }

  if (!isAuthorizedDemoOperator(request, env.DEMO_OPERATOR_SECRET)) {
    return NextResponse.json({ error: "UNAUTHORIZED", message: "Invalid operator passphrase." }, { status: 401 });
  }

  const normalizedDemoNumber = normalizePhoneNumberToE164(env.DEMO_PHONE_NUMBER);

  let body: unknown = null;
  try {
    body = await request.json();
  } catch {
    // No/invalid JSON body — fall back to the configured demo number below.
  }
  const requestedTo = typeof (body as { to?: unknown } | null)?.to === "string" ? (body as { to: string }).to : null;
  const rawTo = requestedTo ?? env.DEMO_PHONE_NUMBER;

  const normalizedTo = normalizePhoneNumberToE164(rawTo);
  if (!normalizedTo) {
    return NextResponse.json(
      { error: "INVALID_NUMBER", message: "Enter a valid UK/international phone number." },
      { status: 400 },
    );
  }

  const requestedMode = (body as { mode?: unknown } | null)?.mode;
  const demoMode: DemoMode = DEMO_MODES.includes(requestedMode as DemoMode) ? (requestedMode as DemoMode) : "scam_honeypot";

  // The operator's own configured demo number is always allowed, on top of
  // whatever else is explicitly allowlisted. Client input never determines
  // this — the allowlist is entirely server-side env config.
  const allowlist = parseAllowedPhoneNumbers(env.DEMO_ALLOWED_PHONE_NUMBERS);
  if (normalizedDemoNumber) allowlist.push(normalizedDemoNumber);

  if (!isAllowedDemoDestination(normalizedTo, allowlist)) {
    return NextResponse.json(
      { error: "NUMBER_NOT_ALLOWED", message: "This number isn't on the demo allowlist." },
      { status: 403 },
    );
  }

  const active = await getActiveCall();
  if (active) {
    return NextResponse.json(
      { error: "DEMO_CALL_ALREADY_ACTIVE", message: "A call is already ringing or in progress." },
      { status: 409 },
    );
  }

  const lastCreatedAt = await getMostRecentDemoCallCreatedAt();
  if (lastCreatedAt) {
    const secondsSinceLast = (Date.now() - lastCreatedAt.getTime()) / 1000;
    if (secondsSinceLast < RATE_LIMIT_COOLDOWN_SECONDS) {
      return NextResponse.json(
        {
          error: "RATE_LIMITED",
          message: `Wait ${Math.ceil(RATE_LIMIT_COOLDOWN_SECONDS - secondsSinceLast)}s before starting another call.`,
        },
        { status: 429 },
      );
    }
  }

  const client = twilio(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN);

  let callSid: string;
  try {
    const call = await client.calls.create({
      to: normalizedTo,
      from: env.TWILIO_PHONE_NUMBER,
      // Same webhook real inbound calls use — it returns the same
      // <Connect><ConversationRelay> TwiML either way.
      url: new URL("/api/twilio/voice", env.PUBLIC_APP_URL).toString(),
      statusCallback: new URL("/api/twilio/status", env.PUBLIC_APP_URL).toString(),
      statusCallbackMethod: "POST",
      statusCallbackEvent: ["initiated", "ringing", "answered", "completed"],
    });
    callSid = call.sid;
  } catch (error) {
    console.error("[demo/start-call] Twilio call creation failed", error);
    return NextResponse.json(
      { error: "PROVIDER_ERROR", message: "Twilio could not start the call." },
      { status: 502 },
    );
  }

  try {
    await createCall({
      twilioCallSid: callSid,
      callerNumberMasked: maskPhoneNumber(normalizedTo),
      persona: PERSONA_DEFAULT,
      direction: "outbound_demo",
      demoMode,
    });
  } catch (error) {
    // The call is already ringing on the phone at this point — log and
    // continue. /api/twilio/voice will create the row if this failed to.
    console.error("[demo/start-call] failed to pre-create call record", error);
  }

  return NextResponse.json({ status: "started", callSid });
}
