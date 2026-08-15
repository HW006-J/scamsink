import { NextResponse } from "next/server";
import { getCallByTwilioSid, markCallActive, markCallEnded, recordCallEvent } from "@/lib/calls";
import { InvalidTwilioSignatureError, readVerifiedTwilioRequest } from "@/lib/twilioAuth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const FAILED_STATUSES = new Set(["busy", "failed", "no-answer", "canceled"]);

export async function POST(request: Request) {
  let params: Record<string, string>;
  try {
    params = await readVerifiedTwilioRequest(request, "/api/twilio/status");
  } catch (error) {
    if (error instanceof InvalidTwilioSignatureError) {
      console.error("[twilio/status] invalid signature");
      return new NextResponse("Forbidden", { status: 403 });
    }
    throw error;
  }

  const callSid = params.CallSid;
  const callStatus = params.CallStatus;
  if (!callSid || !callStatus) {
    return new NextResponse("Bad Request", { status: 400 });
  }

  try {
    const call = await getCallByTwilioSid(callSid);

    if (callStatus === "completed") {
      await markCallEnded(callSid, "completed");
    } else if (FAILED_STATUSES.has(callStatus)) {
      await markCallEnded(callSid, "failed");
    } else if (callStatus === "in-progress") {
      await markCallActive(callSid);
    }

    if (call) {
      await recordCallEvent(call.id, "twilio_status_callback", { callStatus });
    }
  } catch (error) {
    console.error("[twilio/status] failed to process status callback", error);
    // Still 200 — Twilio will otherwise retry aggressively, and this is a
    // best-effort lifecycle signal, not the only source of truth.
  }

  return new NextResponse(null, { status: 204 });
}
