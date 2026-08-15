"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { formatDurationLong, formatDurationShort, formatTimerClock } from "@/lib/duration";
import type { CallDetail, CallHistoryItem, CallMetrics, CallStatus, DashboardState } from "@/lib/types";

const POLL_INTERVAL_MS = 1000;
// Mirrors lib/demoAuth.ts's DEMO_SECRET_HEADER — kept as a plain literal here
// (rather than importing that module) so this client component never pulls
// server-only code (node:crypto) into the browser bundle.
const DEMO_SECRET_HEADER = "x-demo-operator-secret";
const DEMO_SECRET_STORAGE_KEY = "scamsink_demo_operator_secret";

type FetchState =
  | { kind: "connecting" }
  | { kind: "ok"; data: DashboardState; seenActiveIds: ReadonlySet<string> }
  | { kind: "database-unavailable" }
  | { kind: "voice-engine-unavailable" };

/**
 * Polls /api/dashboard-state, and — as a side effect of that same async
 * callback, not a separate effect — tracks which call IDs this page
 * instance has actually watched go ringing/active. That set lets the
 * caller distinguish "a call just finished while I was watching" from "the
 * most recent call in the DB happens to already be finished" (e.g. on a
 * fresh page load), without re-deriving history from scratch each render.
 */
function useDashboardState(): FetchState {
  const [state, setState] = useState<FetchState>({ kind: "connecting" });
  const inFlight = useRef(false);
  const seenActiveIdsRef = useRef<Set<string>>(new Set());

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
      if (data.call && (data.call.status === "ringing" || data.call.status === "active")) {
        seenActiveIdsRef.current.add(data.call.id);
      }
      setState({ kind: "ok", data, seenActiveIds: seenActiveIdsRef.current });
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

/** One-off check of whether this deployment has demo click-to-call configured at all. */
function useDemoCallConfigured(): boolean {
  const [configured, setConfigured] = useState(false);
  useEffect(() => {
    fetch("/api/status", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => setConfigured(Boolean(data?.demoCallConfigured)))
      .catch(() => setConfigured(false));
  }, []);
  return configured;
}

type DemoCallState =
  | { kind: "idle" }
  | { kind: "starting" }
  | { kind: "error"; message: string };

/**
 * Drives "START CALL". The operator passphrase is prompted for once and
 * cached in sessionStorage — never shipped in the JS bundle, never sent
 * anywhere except as a header on this one request. The destination number
 * is sent as-typed; the server is the only thing that normalizes, validates,
 * and allowlist-checks it — this client never decides what's dialable.
 */
function useDemoCall() {
  const [state, setState] = useState<DemoCallState>({ kind: "idle" });
  const inFlightRef = useRef(false);

  const startDemoCall = useCallback(async (to: string) => {
    if (inFlightRef.current) return;

    let secret = window.sessionStorage.getItem(DEMO_SECRET_STORAGE_KEY);
    if (!secret) {
      secret = window.prompt("Operator passphrase to start the call:");
      if (!secret) return;
      window.sessionStorage.setItem(DEMO_SECRET_STORAGE_KEY, secret);
    }

    inFlightRef.current = true;
    setState({ kind: "starting" });
    try {
      const res = await fetch("/api/demo/start-call", {
        method: "POST",
        headers: { [DEMO_SECRET_HEADER]: secret, "content-type": "application/json" },
        body: JSON.stringify({ to }),
      });

      if (res.status === 401) {
        window.sessionStorage.removeItem(DEMO_SECRET_STORAGE_KEY);
        setState({ kind: "error", message: "Wrong operator passphrase — try again." });
        return;
      }
      if (res.status === 400) {
        setState({ kind: "error", message: "Enter a valid UK/international phone number." });
        return;
      }
      if (res.status === 403) {
        setState({ kind: "error", message: "This number isn't on the demo allowlist." });
        return;
      }
      if (res.status === 409) {
        setState({ kind: "error", message: "A call is already ringing or in progress." });
        return;
      }
      if (res.status === 429) {
        const body = await res.json().catch(() => null);
        setState({
          kind: "error",
          message: typeof body?.message === "string" ? body.message : "Please wait before starting another call.",
        });
        return;
      }
      if (res.status === 501) {
        setState({ kind: "error", message: "Demo call mode isn't configured on this deployment." });
        return;
      }
      if (!res.ok) {
        setState({ kind: "error", message: "Twilio could not start the call." });
        return;
      }

      // Success: the next dashboard-state poll will pick up the new
      // ringing call within ~1s and replace this transient state.
      setState({ kind: "idle" });
    } catch {
      setState({ kind: "error", message: "Could not reach ScamSink. Check your connection." });
    } finally {
      inFlightRef.current = false;
    }
  }, []);

  return { state, startDemoCall };
}

/**
 * Loads one call's full transcript on demand, e.g. when a history row is
 * expanded. Fetches at most once per callId — the transcript of a
 * completed/failed call never changes, so a re-expand reuses the cached
 * result instead of refetching.
 */
function useCallDetail(callId: string | null): { detail: CallDetail | null; loading: boolean } {
  const [detail, setDetail] = useState<CallDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const fetchedIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!callId || fetchedIdRef.current === callId) return;
    fetchedIdRef.current = callId;

    let cancelled = false;
    setLoading(true);
    fetch(`/api/calls/${callId}`, { cache: "no-store" })
      .then((res) => (res.ok ? (res.json() as Promise<CallDetail>) : null))
      .then((data) => {
        if (!cancelled) setDetail(data);
      })
      .catch(() => {
        if (!cancelled) setDetail(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [callId]);

  return { detail, loading };
}

type StatusTone = "ready" | "ringing" | "live" | "ended" | "error";

function StatusPill({ label, tone }: { label: string; tone: StatusTone }) {
  const toneClasses: Record<StatusTone, string> = {
    ready: "text-accent-green",
    ringing: "text-accent-red",
    live: "text-accent-red",
    ended: "text-muted",
    error: "text-accent-red",
  };
  const dotClasses: Record<StatusTone, string> = {
    ready: "bg-accent-green",
    ringing: "bg-accent-red pulse-dot",
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

function MetricsBar({ metrics }: { metrics: CallMetrics }) {
  return (
    <div className="flex flex-col items-center gap-6 border-b border-border-subtle px-8 py-10 text-center sm:px-12">
      <div>
        <p className="font-mono text-6xl font-semibold tabular-nums text-accent-green sm:text-7xl">
          {formatTimerClock(metrics.totalTimeWastedSeconds)}
        </p>
        <p className="mt-2 text-xs uppercase tracking-[0.3em] text-muted">Total scammer time wasted</p>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-x-10 gap-y-2 text-sm">
        <div>
          <span className="font-mono text-lg text-foreground">{metrics.totalCalls}</span>{" "}
          <span className="uppercase tracking-wide text-muted">calls</span>
        </div>
        <div>
          <span className="font-mono text-lg text-foreground">
            {formatDurationShort(metrics.averageCallSeconds)}
          </span>{" "}
          <span className="uppercase tracking-wide text-muted">avg</span>
        </div>
        <div>
          <span className="font-mono text-lg text-foreground">{metrics.totalTurns}</span>{" "}
          <span className="uppercase tracking-wide text-muted">turns</span>
        </div>
      </div>
    </div>
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

function StartCallView({
  demoCallConfigured,
  demoState,
  onStartDemoCall,
}: {
  demoCallConfigured: boolean;
  demoState: DemoCallState;
  onStartDemoCall: (to: string) => void;
}) {
  const [phoneValue, setPhoneValue] = useState("");
  const starting = demoState.kind === "starting";

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!phoneValue.trim() || starting) return;
    onStartDemoCall(phoneValue);
  }

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 px-8 py-16">
      <div className="w-full max-w-md rounded-lg border border-border-subtle bg-surface p-8">
        <p className="text-center text-xs uppercase tracking-[0.3em] text-muted">Start a ScamSink call</p>
        {demoCallConfigured ? (
          <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-4">
            <label className="flex flex-col gap-2 text-left">
              <span className="text-xs uppercase tracking-[0.2em] text-muted">Phone number</span>
              <input
                type="tel"
                value={phoneValue}
                onChange={(event) => setPhoneValue(event.target.value)}
                placeholder="+44 7911 123456"
                disabled={starting}
                className="rounded-md border border-border-subtle bg-background px-4 py-3 font-mono text-lg text-foreground outline-none focus:border-accent-red disabled:opacity-50"
              />
            </label>
            <button
              type="submit"
              disabled={starting || !phoneValue.trim()}
              className="rounded-md border border-accent-red bg-accent-red/10 px-6 py-3 text-sm font-semibold uppercase tracking-wide text-accent-red transition hover:bg-accent-red/20 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {starting ? "Starting call…" : "Start call"}
            </button>
            {demoState.kind === "error" && <p className="text-xs text-accent-red">{demoState.message}</p>}
          </form>
        ) : (
          <p className="mt-6 text-center text-sm text-muted">
            Demo call mode isn&apos;t configured on this deployment.
          </p>
        )}
      </div>
      <p className="text-sm text-muted">No active call.</p>
    </div>
  );
}

function DemoBadge() {
  return (
    <span className="rounded border border-border-subtle px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted">
      Demo call
    </span>
  );
}

function LiveView({ data, nowMs }: { data: DashboardState; nowMs: number }) {
  const call = data.call!;
  const clockSkewMs = nowMs - data.serverTimeMs;
  const startedAtMs = call.startedAt ? new Date(call.startedAt).getTime() : nowMs;
  const elapsedSeconds = Math.max(0, Math.floor((nowMs - clockSkewMs - startedAtMs) / 1000));
  const turnCount = data.transcript.filter((m) => m.speaker !== "system").length;

  return (
    <div className="flex flex-1 flex-col gap-8 px-8 py-8 sm:px-12">
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-muted">Live call — time wasted</p>
          <p className="mt-2 font-mono text-6xl font-semibold tabular-nums text-accent-red sm:text-7xl">
            {formatTimerClock(elapsedSeconds)}
          </p>
        </div>
        <div className="flex gap-10 text-right">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-muted">Caller</p>
            <p className="mt-1 font-mono text-lg">{call.callerNumberMasked ?? "Unknown"}</p>
            {call.direction === "outbound_demo" && (
              <div className="mt-1 flex justify-end">
                <DemoBadge />
              </div>
            )}
          </div>
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-muted">Status</p>
            <p className="mt-1 text-lg font-semibold text-accent-red">
              {call.status === "ringing" ? "RINGING" : "CONNECTED"}
            </p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-muted">Turns</p>
            <p className="mt-1 font-mono text-lg">{turnCount}</p>
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

function CompletedView({ data, onCallAgain }: { data: DashboardState; onCallAgain: () => void }) {
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
          {call.direction === "outbound_demo" && (
            <div className="mt-1">
              <DemoBadge />
            </div>
          )}
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

      <div className="flex justify-center">
        <button
          type="button"
          onClick={onCallAgain}
          className="rounded-md border border-accent-green bg-accent-green/10 px-6 py-3 text-sm font-semibold uppercase tracking-wide text-accent-green transition hover:bg-accent-green/20"
        >
          Call again
        </button>
      </div>
    </div>
  );
}

function statusTextColor(status: CallStatus): string {
  switch (status) {
    case "completed":
      return "text-accent-green";
    case "failed":
      return "text-accent-red";
    case "ringing":
    case "active":
      return "text-accent-red";
    default:
      return "text-muted";
  }
}

function HistoryRow({ call, expanded, onToggle }: { call: CallHistoryItem; expanded: boolean; onToggle: () => void }) {
  const { detail, loading } = useCallDetail(expanded ? call.id : null);
  const canExpand = call.status === "completed" || call.status === "failed";

  return (
    <div>
      <button
        type="button"
        onClick={() => canExpand && onToggle()}
        disabled={!canExpand}
        className="flex w-full flex-wrap items-center justify-between gap-3 px-4 py-3 text-left text-sm transition hover:bg-surface-raised disabled:cursor-default disabled:hover:bg-transparent"
      >
        <span className="font-mono text-muted">
          {call.startedAt
            ? new Date(call.startedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
            : "—"}
        </span>
        <span className="font-mono">{call.callerNumberMasked ?? "Unknown"}</span>
        <span className="font-mono text-muted">{formatDurationShort(call.durationSeconds ?? 0)}</span>
        <span className="font-mono text-muted">{call.turns} turns</span>
        <span className={`text-xs font-semibold uppercase tracking-wide ${statusTextColor(call.status)}`}>
          {call.status}
        </span>
      </button>
      {expanded && (
        <div className="border-t border-border-subtle bg-background px-4 py-4">
          {loading && <p className="text-sm text-muted">Loading transcript…</p>}
          {!loading && detail && (
            <div className="flex max-h-96 flex-col">
              <TranscriptPanel transcript={detail.transcript} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function RecentCallsList({ calls }: { calls: CallHistoryItem[] }) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  return (
    <div className="border-t border-border-subtle px-8 py-8 sm:px-12">
      <p className="text-xs uppercase tracking-[0.3em] text-muted">Recent ScamSink calls</p>
      {calls.length === 0 ? (
        <p className="mt-4 text-sm text-muted">No calls yet.</p>
      ) : (
        <div className="mt-4 divide-y divide-border-subtle rounded-lg border border-border-subtle bg-surface">
          {calls.map((call) => (
            <HistoryRow
              key={call.id}
              call={call}
              expanded={expandedId === call.id}
              onToggle={() => setExpandedId((current) => (current === call.id ? null : call.id))}
            />
          ))}
        </div>
      )}
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
  const demoCallConfigured = useDemoCallConfigured();
  const { state: demoState, startDemoCall } = useDemoCall();

  const [dismissedCallId, setDismissedCallId] = useState<string | null>(null);

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
    const isLive = call && (call.status === "ringing" || call.status === "active");
    const isJustCompleted =
      call &&
      (call.status === "completed" || call.status === "failed") &&
      state.seenActiveIds.has(call.id) &&
      call.id !== dismissedCallId;

    if (isLive) {
      statusNode = (
        <StatusPill label={call.status === "ringing" ? "RINGING" : "LIVE"} tone={call.status === "ringing" ? "ringing" : "live"} />
      );
      body = <LiveView data={state.data} nowMs={nowMs} />;
    } else if (isJustCompleted) {
      statusNode = <StatusPill label="READY" tone="ready" />;
      body = <CompletedView data={state.data} onCallAgain={() => setDismissedCallId(call.id)} />;
    } else {
      statusNode = <StatusPill label="READY" tone="ready" />;
      body = (
        <StartCallView
          demoCallConfigured={demoCallConfigured}
          demoState={demoState}
          onStartDemoCall={startDemoCall}
        />
      );
    }
  }

  return (
    <div className="flex min-h-screen flex-1 flex-col">
      <Header statusNode={statusNode} />
      {state.kind === "ok" && <MetricsBar metrics={state.data.metrics} />}
      {body}
      {state.kind === "ok" && <RecentCallsList calls={state.data.recentCalls} />}
    </div>
  );
}
