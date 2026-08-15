import type { RawData, WebSocket } from "ws";
import {
  appendTranscriptMessage,
  getCallByTwilioSid,
  markCallActive,
  markCallEnded,
  recordCallEvent,
} from "./db.js";
import { redactSensitiveNumbers } from "./redact.js";
import { AIProviderError, boundHistory, type AIProvider, type ConversationTurn } from "./ai/index.js";
import {
  advanceDemoScript,
  DEMO_SCRIPT_FALLBACK_LINE,
  INITIAL_DEMO_SCRIPT_STATE,
  type DemoScriptState,
} from "./demoScript.js";
import {
  advanceInfraScript,
  INFRA_SAFE_FALLBACK_LINE,
  INITIAL_INFRA_SCRIPT_STATE,
  type InfraScriptState,
} from "./infraScript.js";

type ScriptMode = "none" | "scam_honeypot" | "infrastructure_simulation";

const FALLBACK_LINE =
  "Sorry, I'm having a bit of trouble hearing you right now. I'll have to call you back.";

// ConversationRelay doesn't expose a documented silence/no-input timeout
// event (checked against Twilio's own reference: the only turn-boundary
// controls are speechTimeout/eotThreshold, which govern when an in-progress
// utterance is finalized, not "the human hasn't said anything at all"), so
// infrastructure-simulation calls track this themselves with a plain timer.
const SILENCE_TIMEOUT_MS = 7_000;

interface TwilioInboundMessage {
  type: string;
  callSid?: string;
  from?: string;
  to?: string;
  voicePrompt?: string;
  digit?: string;
  [key: string]: unknown;
}

/**
 * One ConversationRelay WebSocket connection == one phone call. Owns the
 * conversation history, talks to the AI provider, and persists the
 * transcript as it goes so the dashboard sees it live.
 */
export class RelaySession {
  private callSid: string | null = null;
  private callId: string | null = null;
  private history: ConversationTurn[] = [];
  private closed = false;
  private generation = 0;
  // Outbound demo calls follow one of two deterministic comedy scripts
  // instead of free-form Groq replies, decided once at setup from the
  // call's direction + demo_mode and never changed mid-call. Each
  // RelaySession is one WS connection per call, so this state is
  // inherently isolated per call — no cross-call sharing is possible.
  private scriptMode: ScriptMode = "none";
  private scriptState: DemoScriptState = INITIAL_DEMO_SCRIPT_STATE;
  private infraScriptState: InfraScriptState = INITIAL_INFRA_SCRIPT_STATE;
  // Proactive-continuation timer for infrastructure-simulation calls only.
  // silenceToken invalidates a scheduled timer the instant any real
  // prompt/interrupt arrives, so a proactive line can't fire on top of one
  // already produced by real caller input; the timer is always cleared
  // before a new one is scheduled, so at most one is ever pending.
  private silenceTimer: ReturnType<typeof setTimeout> | null = null;
  private silenceToken = 0;

  constructor(
    private readonly ws: WebSocket,
    private readonly aiProvider: AIProvider,
  ) {
    ws.on("message", (raw) => {
      this.handleMessage(raw).catch((err) => console.error("[relay] message handling error", err));
    });
    ws.on("close", () => {
      this.handleClose().catch((err) => console.error("[relay] close handling error", err));
    });
    ws.on("error", (err) => console.error("[relay] websocket error", err));
  }

  private send(message: Record<string, unknown>): void {
    if (this.ws.readyState === this.ws.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }

  private async handleMessage(raw: RawData): Promise<void> {
    let message: TwilioInboundMessage;
    try {
      message = JSON.parse(raw.toString());
    } catch {
      console.warn("[relay] ignoring non-JSON message from Twilio");
      return;
    }

    switch (message.type) {
      case "setup":
        await this.handleSetup(message);
        return;
      case "prompt":
        // Any real prompt means the human isn't silent — invalidate
        // whatever proactive-continuation timer might be pending before
        // it's rescheduled again once this turn's reply is sent.
        this.silenceToken += 1;
        this.clearSilenceTimer();
        await this.handlePrompt(message);
        return;
      case "interrupt":
        // Caller started talking over ScamSink — abandon the in-flight reply.
        this.silenceToken += 1;
        this.clearSilenceTimer();
        this.generation += 1;
        return;
      case "dtmf":
        return;
      default:
        return;
    }
  }

  private clearSilenceTimer(): void {
    if (this.silenceTimer) {
      clearTimeout(this.silenceTimer);
      this.silenceTimer = null;
    }
  }

  /** Infrastructure-simulation only. Always cancels any existing timer first, so at most one is ever pending. */
  private scheduleSilenceTimer(): void {
    if (this.closed || this.scriptMode !== "infrastructure_simulation") return;
    this.clearSilenceTimer();
    const token = this.silenceToken;
    this.silenceTimer = setTimeout(() => {
      this.handleSilenceTimeout(token).catch((err) => console.error("[relay] silence timeout handling error", err));
    }, SILENCE_TIMEOUT_MS);
  }

  /**
   * Fires after SILENCE_TIMEOUT_MS with no real caller activity. Treated as
   * an empty utterance through the exact same infra-script path a real
   * "vague/unintelligible" turn would take — advanceInfraScript already
   * classifies empty text as OTHER and continues the narrative, so this
   * reuses fully-tested logic rather than inventing a separate mechanism.
   */
  private async handleSilenceTimeout(token: number): Promise<void> {
    this.silenceTimer = null;
    if (this.closed || token !== this.silenceToken) return; // real activity happened since this was scheduled
    const generation = this.generation;
    await this.handleInfraScriptedPrompt("", generation);
    this.scheduleSilenceTimer();
  }

  private async handleSetup(message: TwilioInboundMessage): Promise<void> {
    if (!message.callSid) {
      console.error("[relay] setup message missing callSid");
      return;
    }
    this.callSid = message.callSid;

    const call = await getCallByTwilioSid(message.callSid).catch((err) => {
      console.error("[relay] failed to look up call", err);
      return null;
    });

    if (!call) {
      console.error(`[relay] no call record found for CallSid=${message.callSid}; ending`);
      this.send({ type: "end" });
      this.ws.close();
      return;
    }

    this.callId = call.id;
    this.scriptMode =
      call.direction === "outbound_demo"
        ? call.demoMode === "infrastructure_simulation"
          ? "infrastructure_simulation"
          : "scam_honeypot"
        : "none";
    // Start waiting for either a reply or silence — ScamSink carries the
    // conversation forward on its own if the human doesn't respond.
    this.scheduleSilenceTimer();
    await Promise.all([
      markCallActive(message.callSid),
      recordCallEvent(call.id, "voice_server_connected"),
    ]).catch((err) => console.error("[relay] failed to mark call active", err));
  }

  private async handlePrompt(message: TwilioInboundMessage): Promise<void> {
    const text = message.voicePrompt?.trim();
    if (!text || !this.callId || !this.callSid) return;

    const redacted = redactSensitiveNumbers(text);
    this.history.push({ role: "user", content: redacted });
    await appendTranscriptMessage(this.callId, "caller", redacted).catch((err) =>
      console.error("[relay] failed to persist caller transcript", err),
    );

    const generation = this.generation;

    if (this.scriptMode === "scam_honeypot") {
      await this.handleScriptedPrompt(redacted, generation);
      return;
    }
    if (this.scriptMode === "infrastructure_simulation") {
      await this.handleInfraScriptedPrompt(redacted, generation);
      this.scheduleSilenceTimer();
      return;
    }

    let fullReply = "";

    try {
      fullReply = await this.aiProvider.streamReply(boundHistory(this.history), (token) => {
        if (this.closed || generation !== this.generation) return;
        this.send({ type: "text", token, last: false });
      });
    } catch (err) {
      const detail = err instanceof AIProviderError ? err.message : String(err);
      // The cause is the underlying SDK error (e.g. "401 Invalid API Key",
      // "model_not_found") — safe to log: provider SDKs don't echo the API
      // key back in error messages, and this is what actually explains a
      // failure beyond the generic wrapper message.
      const cause =
        err instanceof AIProviderError && err.cause instanceof Error ? err.cause.message : undefined;
      console.error("[relay] AI provider failed:", detail, cause ? `(cause: ${cause})` : "");
      if (this.callId) {
        await recordCallEvent(this.callId, "ai_provider_error", { message: detail, cause }).catch(() => {});
      }
      if (!this.closed && generation === this.generation) {
        this.send({ type: "text", token: FALLBACK_LINE, last: true });
        this.send({ type: "end" });
      }
      return;
    }

    if (this.closed || generation !== this.generation) return;

    this.send({ type: "text", token: "", last: true });

    if (fullReply.trim()) {
      this.history.push({ role: "assistant", content: fullReply });
      if (this.callId) {
        await appendTranscriptMessage(this.callId, "scamsink", fullReply).catch((err) =>
          console.error("[relay] failed to persist scamsink transcript", err),
        );
      }
    }
  }

  /**
   * Deterministic reply path for outbound demo calls. advanceDemoScript is
   * synchronous and pure — there is no network call here that can hang or
   * fail — but this is still wrapped defensively so that even a bug in the
   * state machine can never result in silence: `line` is always set to
   * either a scripted line or the fixed fallback, and a reply is always
   * sent (respecting the same interrupt/close checks as the dynamic path).
   */
  private async handleScriptedPrompt(callerText: string, generation: number): Promise<void> {
    let line: string;
    try {
      const result = advanceDemoScript(this.scriptState, callerText);
      this.scriptState = result.nextState;
      line = result.line;
      if (this.callId) {
        await recordCallEvent(this.callId, "demo_script_turn", {
          fromIndex: result.transition.fromIndex,
          toIndex: result.transition.toIndex,
          matched: result.transition.matched,
        }).catch(() => {});
      }
    } catch (err) {
      console.error("[relay] demo script state machine failed, using safe fallback:", err);
      line = DEMO_SCRIPT_FALLBACK_LINE;
    }

    if (this.closed || generation !== this.generation) return;

    this.send({ type: "text", token: line, last: true });

    if (this.callId) {
      await appendTranscriptMessage(this.callId, "scamsink", line).catch((err) =>
        console.error("[relay] failed to persist scamsink transcript", err),
      );
    }
  }

  /**
   * Deterministic reply path for "CRITICAL INFRASTRUCTURE SIMULATION" demo
   * calls — called both reactively (a real caller prompt) and proactively
   * (handleSilenceTimeout, with an empty humanText). Same shape and same
   * guarantees as handleScriptedPrompt: pure, synchronous state machine, no
   * network call that can hang, and a reply is always sent unless the
   * caller has already interrupted or the connection is closed.
   */
  private async handleInfraScriptedPrompt(humanText: string, generation: number): Promise<void> {
    let line: string;
    try {
      const result = advanceInfraScript(this.infraScriptState, humanText);
      this.infraScriptState = result.nextState;
      line = result.line;
      if (this.callId) {
        await recordCallEvent(this.callId, "infra_script_turn", {
          intent: result.transition.intent,
          phase: result.transition.phase,
          mode: result.transition.mode,
        }).catch(() => {});
      }
    } catch (err) {
      console.error("[relay] infra script state machine failed, using safe fallback:", err);
      line = INFRA_SAFE_FALLBACK_LINE;
    }

    if (this.closed || generation !== this.generation) return;

    this.send({ type: "text", token: line, last: true });

    if (this.callId) {
      await appendTranscriptMessage(this.callId, "scamsink", line).catch((err) =>
        console.error("[relay] failed to persist scamsink transcript", err),
      );
    }
  }

  private async handleClose(): Promise<void> {
    this.closed = true;
    this.clearSilenceTimer();
    if (!this.callSid) return;
    await markCallEnded(this.callSid, "completed").catch((err) =>
      console.error("[relay] failed to mark call completed on disconnect", err),
    );
    if (this.callId) {
      await recordCallEvent(this.callId, "voice_server_disconnected").catch(() => {});
    }
  }
}
