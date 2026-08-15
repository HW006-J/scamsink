import { NextResponse } from "next/server";
import { getCallByTwilioSid } from "@/lib/calls";
import { INFRA_SIMULATION_OPENING_LINE } from "@/lib/demoScripts";
import { getServerEnv } from "@/lib/env";
import { generateRelayToken } from "@/lib/relayAuth";
import { InvalidTwilioSignatureError, readVerifiedTwilioRequest } from "@/lib/twilioAuth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Safe, non-interactive response for any call this webhook doesn't
 * recognize as one of our own outbound demo calls — most notably, someone
 * dialing the Twilio number directly. The product no longer has a real
 * inbound engagement flow (the scam-honeypot mode was removed), so this
 * never connects to ConversationRelay or the voice server at all: just a
 * short statement and a hangup, with no DB row created and no AI/script
 * involvement of any kind.
 */
function safeHangupTwiml(): string {
  const message = xmlEscape("This number is not currently accepting calls. Goodbye.");
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Say>${message}</Say><Hangup/></Response>`;
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
  if (!callSid) {
    return new NextResponse("Bad Request", { status: 400 });
  }

  // Our own outbound demo calls always have their row pre-created by
  // /api/demo/start-call before Twilio ever calls this webhook. Anything
  // else — most notably a genuine new inbound call — gets the safe hangup
  // below instead of ever touching ConversationRelay, the voice server, or
  // the database.
  let existing;
  try {
    existing = await getCallByTwilioSid(callSid);
  } catch (error) {
    console.error("[twilio/voice] failed to look up call record", error);
    return new NextResponse(safeHangupTwiml(), { status: 200, headers: { "Content-Type": "text/xml" } });
  }

  if (!existing) {
    return new NextResponse(safeHangupTwiml(), { status: 200, headers: { "Content-Type": "text/xml" } });
  }

  const token = generateRelayToken(callSid, env.VOICE_SERVER_SHARED_SECRET);
  const relayUrl = new URL(env.VOICE_SERVER_URL);
  relayUrl.searchParams.set("callSid", callSid);
  relayUrl.searchParams.set("token", token);

  // ScamSink speaks first, via Twilio's own connect-time TTS — there's no
  // race against the WS relay session starting up, since this greeting is
  // spoken independently of it.
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <ConversationRelay url="${xmlEscape(relayUrl.toString())}" welcomeGreeting="${xmlEscape(INFRA_SIMULATION_OPENING_LINE)}" />
  </Connect>
</Response>`;

  return new NextResponse(twiml, { status: 200, headers: { "Content-Type": "text/xml" } });
}
