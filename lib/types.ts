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

export const dashboardStateSchema = z.object({
  call: z
    .object({
      id: z.string(),
      status: z.enum(CALL_STATUSES),
      direction: z.enum(CALL_DIRECTIONS),
      callerNumberMasked: z.string().nullable(),
      startedAt: z.string().nullable(),
      endedAt: z.string().nullable(),
      durationSeconds: z.number().nullable(),
      persona: z.string(),
    })
    .nullable(),
  transcript: z.array(
    z.object({
      id: z.string(),
      speaker: z.enum(SPEAKERS),
      content: z.string(),
      createdAt: z.string(),
    }),
  ),
  serverTimeMs: z.number(),
});

export type DashboardState = z.infer<typeof dashboardStateSchema>;
