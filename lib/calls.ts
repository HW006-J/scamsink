import { query, queryOne } from "./db";
import type { CallStatus, DashboardState, Speaker } from "./types";

export interface CallLookup {
  id: string;
  status: CallStatus;
}

export async function getCallByTwilioSid(twilioCallSid: string): Promise<CallLookup | null> {
  return queryOne<CallLookup>(
    `select id, status from calls where twilio_call_sid = $1`,
    [twilioCallSid],
  );
}

interface CreateCallInput {
  twilioCallSid: string;
  callerNumberMasked: string | null;
  persona: string;
}

/**
 * Idempotent: Twilio can retry the voice webhook for the same CallSid, so
 * this upserts rather than erroring on the unique constraint.
 */
export async function createCall(input: CreateCallInput): Promise<{ id: string }> {
  const row = await queryOne<{ id: string }>(
    `insert into calls (twilio_call_sid, status, caller_number_masked, persona)
     values ($1, 'ringing', $2, $3)
     on conflict (twilio_call_sid)
     do update set caller_number_masked = excluded.caller_number_masked
     returning id`,
    [input.twilioCallSid, input.callerNumberMasked, input.persona],
  );
  if (!row) throw new Error("Failed to create call record");
  return row;
}

/** Idempotent: safe to call repeatedly for the same call (e.g. duplicate status callbacks). */
export async function markCallActive(twilioCallSid: string): Promise<void> {
  await query(
    `update calls
     set status = 'active', started_at = coalesce(started_at, now()), updated_at = now()
     where twilio_call_sid = $1 and status != 'completed' and status != 'failed'`,
    [twilioCallSid],
  );
}

/** Idempotent: ended_at/duration_seconds only get set once, via coalesce. */
export async function markCallEnded(
  twilioCallSid: string,
  status: Extract<CallStatus, "completed" | "failed">,
): Promise<void> {
  await query(
    `update calls
     set status = $2,
         ended_at = coalesce(ended_at, now()),
         duration_seconds = coalesce(
           duration_seconds,
           greatest(0, extract(epoch from (now() - coalesce(started_at, now())))::int)
         ),
         updated_at = now()
     where twilio_call_sid = $1`,
    [twilioCallSid, status],
  );
}

export async function appendTranscriptMessage(
  callId: string,
  speaker: Speaker,
  content: string,
): Promise<void> {
  await query(`insert into transcript_messages (call_id, speaker, content) values ($1, $2, $3)`, [
    callId,
    speaker,
    content,
  ]);
}

export async function recordCallEvent(
  callId: string,
  eventType: string,
  metadata: Record<string, unknown> | null = null,
): Promise<void> {
  await query(`insert into call_events (call_id, event_type, metadata) values ($1, $2, $3)`, [
    callId,
    eventType,
    metadata ? JSON.stringify(metadata) : null,
  ]);
}

interface CallRow {
  id: string;
  twilio_call_sid: string;
  status: CallStatus;
  caller_number_masked: string | null;
  started_at: Date | null;
  ended_at: Date | null;
  duration_seconds: number | null;
  persona: string;
}

interface TranscriptRow {
  id: string;
  speaker: Speaker;
  content: string;
  created_at: Date;
}

function toIso(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

/**
 * The dashboard is single-call focused: this returns the most recently
 * created call (active or otherwise) with its full transcript. The schema
 * supports listing call history later, but the MVP UI never needs it.
 */
export async function getDashboardState(): Promise<DashboardState> {
  const call = await queryOne<CallRow>(
    `select id, twilio_call_sid, status, caller_number_masked, started_at, ended_at, duration_seconds, persona
     from calls
     order by created_at desc
     limit 1`
  );

  if (!call) {
    return { call: null, transcript: [], serverTimeMs: Date.now() };
  }

  const transcriptRows = await query<TranscriptRow>(
    `select id, speaker, content, created_at
     from transcript_messages
     where call_id = $1
     order by created_at asc`,
    [call.id]
  );

  return {
    call: {
      id: call.id,
      status: call.status,
      callerNumberMasked: call.caller_number_masked,
      startedAt: toIso(call.started_at),
      endedAt: toIso(call.ended_at),
      durationSeconds: call.duration_seconds,
      persona: call.persona,
    },
    transcript: transcriptRows.map((row) => ({
      id: row.id,
      speaker: row.speaker,
      content: row.content,
      createdAt: row.created_at.toISOString(),
    })),
    serverTimeMs: Date.now(),
  };
}
