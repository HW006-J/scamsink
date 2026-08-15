import { NextResponse } from "next/server";
import { createCall } from "@/lib/calls";
import { getServerEnv } from "@/lib/env";
import { maskPhoneNumber } from "@/lib/mask";
import { PERSONA_DEFAULT } from "@/lib/types";
import { generateRelayToken } from "@/lib/relayAuth";
import { InvalidTwilioSignatureError, readVerifiedTwilioRequest } from "@/lib/twilioAuth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const WELCOME_GREETING = "Hello? Sorry, who's calling?";

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export async function POST(request: Request) {
  const env = getServerEnv();

  let params: Record<string, string>;
  try {
    params = await readVerifiedTwilioRequest(request, "/api/twilio/voice");
  } catch (error) {
    if (error instanceof InvalidTwilioSignatureError) {
      console.error("[twilio/voice] invalid signature");
      return new NextResponse("Forbidden", { status: 403 });
    }
    throw error;
  }

  const callSid = params.CallSid;
  const from = params.From;
  if (!callSid) {
    return new NextResponse("Bad Request", { status: 400 });
  }

  try {
    await createCall({
      twilioCallSid: callSid,
      callerNumberMasked: maskPhoneNumber(from),
      persona: PERSONA_DEFAULT,
    });
  } catch (error) {
    console.error("[twilio/voice] failed to create call record", error);
    // Fail the call cleanly rather than connecting a relay with no DB row behind it.
    const failXml = `<?xml version="1.0" encoding="UTF-8"?><Response><Say>Sorry, we're experiencing a technical issue. Goodbye.</Say><Hangup/></Response>`;
    return new NextResponse(failXml, { status: 200, headers: { "Content-Type": "text/xml" } });
  }

  const token = generateRelayToken(callSid, env.VOICE_SERVER_SHARED_SECRET);
  const relayUrl = new URL(env.VOICE_SERVER_URL);
  relayUrl.searchParams.set("callSid", callSid);
  relayUrl.searchParams.set("token", token);

  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <ConversationRelay url="${xmlEscape(relayUrl.toString())}" welcomeGreeting="${xmlEscape(WELCOME_GREETING)}" />
  </Connect>
</Response>`;

  return new NextResponse(twiml, { status: 200, headers: { "Content-Type": "text/xml" } });
}
