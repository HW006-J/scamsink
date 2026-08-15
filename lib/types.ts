import { z } from "zod";

export const CALL_STATUSES = ["ringing", "active", "completed", "failed"] as const;
export type CallStatus = (typeof CALL_STATUSES)[number];

export const CALL_DIRECTIONS = ["inbound", "outbound_demo"] as const;
export type CallDirection = (typeof CALL_DIRECTIONS)[number];

export const SPEAKERS = ["caller", "scamsink", "system"] as const;
export type Speaker = (typeof SPEAKERS)[number];

export const PERSONA_DEFAULT = "default" as const;

export interface Call {
  id: string;
  twilioCallSid: string;
  status: CallStatus;
  direction: CallDirection;
  callerNumberMasked: string | null;
  startedAt: string | null;
  endedAt: string | null;
  durationSeconds: number | null;
  persona: string;
  createdAt: string;
  updatedAt: string;
}

export interface TranscriptMessage {
  id: string;
  callId: string;
  speaker: Speaker;
  content: string;
  createdAt: string;
}

export interface CallEvent {
  id: string;
  callId: string;
  eventType: string;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export interface CallMetrics {
  totalCalls: number;
  totalTimeWastedSeconds: number;
  averageCallSeconds: number;
  totalTurns: number;
}

const callSnapshotSchema = z.object({
  id: z.string(),
  status: z.enum(CALL_STATUSES),
  direction: z.enum(CALL_DIRECTIONS),
  callerNumberMasked: z.string().nullable(),
  startedAt: z.string().nullable(),
  endedAt: z.string().nullable(),
  durationSeconds: z.number().nullable(),
  persona: z.string(),
});

const transcriptMessageSchema = z.object({
  id: z.string(),
  speaker: z.enum(SPEAKERS),
  content: z.string(),
  createdAt: z.string(),
});

const callMetricsSchema = z.object({
  totalCalls: z.number(),
  totalTimeWastedSeconds: z.number(),
  averageCallSeconds: z.number(),
  totalTurns: z.number(),
});

const callHistoryItemSchema = callSnapshotSchema.extend({
  turns: z.number(),
  createdAt: z.string(),
});

export type CallHistoryItem = z.infer<typeof callHistoryItemSchema>;

export const dashboardStateSchema = z.object({
  call: callSnapshotSchema.nullable(),
  transcript: z.array(transcriptMessageSchema),
  metrics: callMetricsSchema,
  recentCalls: z.array(callHistoryItemSchema),
  serverTimeMs: z.number(),
});

export type DashboardState = z.infer<typeof dashboardStateSchema>;

export const callDetailSchema = z.object({
  call: callSnapshotSchema,
  transcript: z.array(transcriptMessageSchema),
});

export type CallDetail = z.infer<typeof callDetailSchema>;
