"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { formatDurationLong, formatDurationShort, formatTimerClock } from "@/lib/duration";
import type { DashboardState } from "@/lib/types";

const POLL_INTERVAL_MS = 1000;

type FetchState =
  | { kind: "connecting" }
  | { kind: "ok"; data: DashboardState }
  | { kind: "database-unavailable" }
  | { kind: "voice-engine-unavailable" };

function useDashboardState(): FetchState {
  const [state, setState] = useState<FetchState>({ kind: "connecting" });
  const inFlight = useRef(false);

  const poll = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const res = await fetch("/api/dashboard-state", { cache: "no-store" });
      if (res.status === 503) {
        setState({ kind: "database-unavailable" });
        return;
      }
      if (!res.ok) {
        setState({ kind: "voice-engine-unavailable" });
        return;
      }
      const data = (await res.json()) as DashboardState;
      setState({ kind: "ok", data });
    } catch {
      setState({ kind: "database-unavailable" });
    } finally {
      inFlight.current = false;
    }
  }, []);

  useEffect(() => {
    const kickoffId = setTimeout(poll, 0);
    const intervalId = setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      clearTimeout(kickoffId);
      clearInterval(intervalId);
    };
  }, [poll]);

  return state;
}

/** Ticks once a second between polls so the timer moves smoothly, not just on each 1s poll. */
function useNowMs(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, []);
  return now;
}

function StatusPill({ label, tone }: { label: string; tone: "ready" | "live" | "ended" | "error" }) {
  const toneClasses: Record<typeof tone, string> = {
    ready: "text-accent-green",
    live: "text-accent-red",
    ended: "text-muted",
    error: "text-accent-red",
  };
  const dotClasses: Record<typeof tone, string> = {
    ready: "bg-accent-green",
    live: "bg-accent-red pulse-dot",
    ended: "bg-muted",
    error: "bg-accent-red pulse-dot",
  };
  return (
    <div className={`flex items-center gap-2 text-sm font-medium tracking-wide ${toneClasses[tone]}`}>
      <span className={`h-2 w-2 rounded-full ${dotClasses[tone]}`} />
      {label}
    </div>
  );
}

function Header({ statusNode }: { statusNode: React.ReactNode }) {
  return (
    <header className="flex items-baseline justify-between border-b border-border-subtle px-8 py-6 sm:px-12">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">SCAMSINK</h1>
        <p className="mt-1 text-xs uppercase tracking-[0.2em] text-muted">
          Turning scam calls into dead ends
        </p>
      </div>
      {statusNode}
    </header>
  );
}

function TranscriptPanel({ transcript }: { transcript: DashboardState["transcript"] }) {
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  useEffect(() => {
    if (autoScroll) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }, [transcript, autoScroll]);

  function handleScroll() {
    const el = containerRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    setAutoScroll(distanceFromBottom < 80);
  }

  if (transcript.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center rounded-lg border border-border-subtle bg-surface text-sm text-muted">
        No transcript yet.
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      onScroll={handleScroll}
      className="flex-1 space-y-4 overflow-y-auto rounded-lg border border-border-subtle bg-surface p-6"
    >
      {transcript.map((message) => {
        const isCaller = message.speaker === "caller";
        const isSystem = message.speaker === "system";
        if (isSystem) {
          return (
            <div key={message.id} className="text-center text-xs uppercase tracking-wide text-muted">
              {message.content}
            </div>
          );
        }
        return (
          <div key={message.id} className="max-w-2xl">
            <div
              className={`text-xs font-semibold uppercase tracking-wide ${
                isCaller ? "text-muted" : "text-accent-green"
              }`}
            >
              {isCaller ? "Caller" : "ScamSink"}
            </div>
            <p className="mt-1 whitespace-pre-wrap text-base leading-relaxed text-foreground">
              {message.content}
            </p>
          </div>
        );
      })}
      <div ref={bottomRef} />
    </div>
  );
}

function IdleView({ scamSinkNumber }: { scamSinkNumber: string | null }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-10 px-8 py-16 text-center">
      <div>
        <p className="text-sm uppercase tracking-[0.3em] text-muted">Waiting for incoming call</p>
        <p className="mt-6 font-mono text-7xl font-semibold tabular-nums sm:text-8xl">00:00</p>
        <p className="mt-2 text-xs uppercase tracking-[0.2em] text-muted">Time wasted</p>
      </div>
      <div className="rounded-lg border border-border-subtle bg-surface px-6 py-4">
        <p className="text-xs uppercase tracking-[0.2em] text-muted">ScamSink number</p>
        <p className="mt-1 font-mono text-xl">{scamSinkNumber ?? "Not configured"}</p>
      </div>
      <p className="text-sm text-muted">No active call.</p>
    </div>
  );
}

function LiveView({ data, nowMs }: { data: DashboardState; nowMs: number }) {
  const call = data.call!;
  const clockSkewMs = nowMs - data.serverTimeMs;
  const startedAtMs = call.startedAt ? new Date(call.startedAt).getTime() : nowMs;
  const elapsedSeconds = Math.max(0, Math.floor((nowMs - clockSkewMs - startedAtMs) / 1000));

  return (
    <div className="flex flex-1 flex-col gap-8 px-8 py-8 sm:px-12">
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-muted">Active call</p>
          <p className="mt-2 font-mono text-6xl font-semibold tabular-nums text-accent-red sm:text-7xl">
            {formatTimerClock(elapsedSeconds)}
          </p>
        </div>
        <div className="flex gap-10 text-right">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-muted">Caller</p>
            <p className="mt-1 font-mono text-lg">{call.callerNumberMasked ?? "Unknown"}</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-muted">Status</p>
            <p className="mt-1 text-lg font-semibold text-accent-red">
              {call.status === "ringing" ? "RINGING" : "ENGAGED"}
            </p>
          </div>
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-3">
        <p className="text-xs uppercase tracking-[0.3em] text-muted">Live transcript</p>
        <TranscriptPanel transcript={data.transcript} />
      </div>
    </div>
  );
}

function CompletedView({ data }: { data: DashboardState }) {
  const call = data.call!;
  const durationSeconds = call.durationSeconds ?? 0;
  const turnCount = data.transcript.filter((m) => m.speaker !== "system").length;

  return (
    <div className="flex flex-1 flex-col gap-8 px-8 py-8 sm:px-12">
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-muted">Call complete</p>
          <p className="mt-2 font-mono text-6xl font-semibold tabular-nums text-accent-green sm:text-7xl">
            {formatDurationShort(durationSeconds)}
          </p>
          <p className="mt-1 text-xs uppercase tracking-[0.2em] text-muted">Time wasted</p>
        </div>
        <div className="max-w-sm text-right text-sm text-muted">
          Caller kept away from potential victims for:
          <br />
          <span className="text-foreground">{formatDurationLong(durationSeconds)}</span>
        </div>
      </div>

      <div className="flex flex-wrap gap-8 text-sm">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-muted">Caller</p>
          <p className="mt-1 font-mono">{call.callerNumberMasked ?? "Unknown"}</p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-muted">Started</p>
          <p className="mt-1 font-mono">
            {call.startedAt ? new Date(call.startedAt).toLocaleTimeString() : "—"}
          </p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-muted">Ended</p>
          <p className="mt-1 font-mono">
            {call.endedAt ? new Date(call.endedAt).toLocaleTimeString() : "—"}
          </p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-muted">Turns</p>
          <p className="mt-1 font-mono">{turnCount}</p>
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-3">
        <p className="text-xs uppercase tracking-[0.3em] text-muted">Transcript</p>
        <TranscriptPanel transcript={data.transcript} />
      </div>
    </div>
  );
}

function FailureBanner({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 px-8 text-center">
      <p className="text-2xl font-semibold text-accent-red">{title}</p>
      <p className="max-w-md text-sm text-muted">{detail}</p>
    </div>
  );
}

export default function DashboardPage() {
  const state = useDashboardState();
  const nowMs = useNowMs();

  let statusNode: React.ReactNode = <StatusPill label="CONNECTING" tone="ended" />;
  let body: React.ReactNode = null;

  if (state.kind === "connecting") {
    body = <div className="flex flex-1 items-center justify-center text-muted">Connecting…</div>;
  } else if (state.kind === "database-unavailable") {
    statusNode = <StatusPill label="OFFLINE" tone="error" />;
    body = (
      <FailureBanner
        title="DATABASE UNAVAILABLE"
        detail="ScamSink can't reach its database right now. Check DATABASE_URL and Neon status."
      />
    );
  } else if (state.kind === "voice-engine-unavailable") {
    statusNode = <StatusPill label="OFFLINE" tone="error" />;
    body = (
      <FailureBanner
        title="VOICE ENGINE UNAVAILABLE"
        detail="The dashboard API returned an unexpected error. Check server logs."
      />
    );
  } else {
    const { call } = state.data;
    if (!call) {
      statusNode = <StatusPill label="READY" tone="ready" />;
      body = <IdleView scamSinkNumber={null} />;
    } else if (call.status === "ringing" || call.status === "active") {
      statusNode = <StatusPill label="LIVE" tone="live" />;
      body = <LiveView data={state.data} nowMs={nowMs} />;
    } else {
      statusNode = <StatusPill label="READY" tone="ready" />;
      body = <CompletedView data={state.data} />;
    }
  }

  return (
    <div className="flex min-h-screen flex-1 flex-col">
      <Header statusNode={statusNode} />
      {body}
    </div>
  );
}
