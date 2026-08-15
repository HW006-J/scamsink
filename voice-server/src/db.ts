import { Pool, type QueryResultRow } from "pg";
import type { Env } from "./env.js";

let pool: Pool | null = null;

export function initPool(env: Env): void {
  pool = new Pool({ connectionString: env.DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 5 });
}

function getPool(): Pool {
  if (!pool) throw new Error("DB pool not initialized — call initPool(env) at startup");
  return pool;
}

async function query<T extends QueryResultRow = QueryResultRow>(text: string, params?: unknown[]): Promise<T[]> {
  const result = await getPool().query<T>(text, params);
  return result.rows;
}

async function queryOne<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[]
): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows[0] ?? null;
}

export type CallStatus = "ringing" | "active" | "completed" | "failed";
export type CallDirection = "inbound" | "outbound_demo";
export type DemoMode = "scam_honeypot" | "infrastructure_simulation";
export type Speaker = "caller" | "scamsink" | "system";

export interface CallLookup {
  id: string;
  status: CallStatus;
  direction: CallDirection;
  demoMode: DemoMode | null;
}

interface CallLookupRow {
  id: string;
  status: CallStatus;
  direction: CallDirection;
  demo_mode: DemoMode | null;
}

export async function getCallByTwilioSid(twilioCallSid: string): Promise<CallLookup | null> {
  const row = await queryOne<CallLookupRow>(
    `select id, status, direction, demo_mode from calls where twilio_call_sid = $1`,
    [twilioCallSid],
  );
  if (!row) return null;
  return { id: row.id, status: row.status, direction: row.direction, demoMode: row.demo_mode };
}

/** Idempotent: safe to call repeatedly for the same call. */
export async function markCallActive(twilioCallSid: string): Promise<void> {
  await query(
    `update calls
     set status = 'active', started_at = coalesce(started_at, now()), updated_at = now()
     where twilio_call_sid = $1 and status != 'completed' and status != 'failed'`,
    [twilioCallSid]
  );
}

/** Idempotent: ended_at/duration_seconds only ever get set once, via coalesce. */
export async function markCallEnded(
  twilioCallSid: string,
  status: Extract<CallStatus, "completed" | "failed">
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
     where twilio_call_sid = $1 and status != 'completed' and status != 'failed'`,
    [twilioCallSid, status]
  );
}

export async function appendTranscriptMessage(callId: string, speaker: Speaker, content: string): Promise<void> {
  await query(`insert into transcript_messages (call_id, speaker, content) values ($1, $2, $3)`, [
    callId,
    speaker,
    content,
  ]);
}

export async function recordCallEvent(
  callId: string,
  eventType: string,
  metadata: Record<string, unknown> | null = null
): Promise<void> {
  await query(`insert into call_events (call_id, event_type, metadata) values ($1, $2, $3)`, [
    callId,
    eventType,
    metadata ? JSON.stringify(metadata) : null,
  ]);
}
