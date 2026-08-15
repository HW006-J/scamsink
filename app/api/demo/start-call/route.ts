import twilio from "twilio";
import { NextResponse } from "next/server";
import { createCall, getActiveCall } from "@/lib/calls";
import { isAuthorizedDemoOperator } from "@/lib/demoAuth";
import { getServerEnv } from "@/lib/env";
import { maskPhoneNumber } from "@/lib/mask";
import { PERSONA_DEFAULT } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

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

  const active = await getActiveCall();
  if (active) {
    return NextResponse.json(
      { error: "DEMO_CALL_ALREADY_ACTIVE", message: "A call is already ringing or in progress." },
      { status: 409 },
    );
  }

  const client = twilio(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN);

  let callSid: string;
  try {
    const call = await client.calls.create({
      to: env.DEMO_PHONE_NUMBER,
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
      callerNumberMasked: maskPhoneNumber(env.DEMO_PHONE_NUMBER),
      persona: PERSONA_DEFAULT,
      direction: "outbound_demo",
    });
  } catch (error) {
    // The call is already ringing on the phone at this point — log and
    // continue. /api/twilio/voice will create the row if this failed to.
    console.error("[demo/start-call] failed to pre-create call record", error);
  }

  return NextResponse.json({ status: "started", callSid });
}
