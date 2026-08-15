import type { RawData, WebSocket } from "ws";
import {
  appendTranscriptMessage,
  getCallByTwilioSid,
  markCallActive,
  markCallEnded,
  recordCallEvent,
} from "./db.js";
import { redactSensitiveNumbers } from "./redact.js";
import {
  advanceInfraScript,
  INFRA_OPENING_LINE,
  INFRA_SAFE_FALLBACK_LINE,
  INITIAL_INFRA_SCRIPT_STATE,
  type InfraScriptState,
} from "./infraScript.js";
import { estimateProactiveDelayMs } from "./ttsTiming.js";

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
 * One ConversationRelay WebSocket connection == one phone call. The product
 * is outbound-only now (infrastructure simulation): the Next.js app never
 * routes a genuinely new inbound call here at all — see
 * app/api/twilio/voice/route.ts, which answers unexpected inbound calls
 * with a safe, non-interactive hangup instead of connecting to this relay.
 * So every call this class ever sees is an outbound_demo call, and its
 * reply is always the deterministic infra-simulation script — no LLM/Groq
 * involvement anywhere in this path.
 */
export class RelaySession {
  private callSid: string | null = null;
  private callId: string | null = null;
  private closed = false;
  private generation = 0;
  // Defensive: even though the Next.js app never routes a genuine inbound
  // call to this relay (see the class doc above), this guard means that if
  // a non-outbound_demo row ever did reach here, RelaySession would simply
  // stay silent rather than engaging with any script.
  private isOutboundDemo = false;
  private infraScriptState: InfraScriptState = INITIAL_INFRA_SCRIPT_STATE;
  // Proactive-continuation timer. silenceToken invalidates a scheduled
  // timer the instant any real prompt/interrupt arrives, so a proactive
  // line can't fire on top of one already produced by real caller input;
  // the timer is always cleared before a new one is scheduled, so at most
  // one is ever pending.
  private silenceTimer: ReturnType<typeof setTimeout> | null = null;
  private silenceToken = 0;

  constructor(private readonly ws: WebSocket) {
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

  /**
   * Delay is estimated from `justSpokenLine` — not a flat constant — so the
   * window scales with how long that specific line actually takes to speak
   * (see ttsTiming.ts): estimated playback time, THEN a genuine
   * human-response grace period, only after which a proactive continuation
   * may fire. Always cancels any existing timer first, so at most one is
   * ever pending.
   */
  private scheduleSilenceTimer(justSpokenLine: string): void {
    if (this.closed) return;
    this.clearSilenceTimer();
    const token = this.silenceToken;
    const delayMs = estimateProactiveDelayMs(justSpokenLine);
    this.silenceTimer = setTimeout(() => {
      this.handleSilenceTimeout(token).catch((err) => console.error("[relay] silence timeout handling error", err));
    }, delayMs);
  }

  /**
   * Fires once estimated playback + the human-response grace period has
   * elapsed with no real caller activity. Treated as an empty utterance
   * through the exact same infra-script path a real "vague/unintelligible"
   * turn would take — advanceInfraScript already classifies empty text as
   * OTHER and continues the narrative, so this reuses fully-tested logic
   * rather than inventing a separate mechanism. Rescheduling the NEXT timer
   * happens inside handleInfraScriptedPrompt itself, estimated from
   * whatever line this proactive turn just spoke — so a silent call gets
   * naturally spaced beats, never back-to-back TTS.
   */
  private async handleSilenceTimeout(token: number): Promise<void> {
    this.silenceTimer = null;
    if (this.closed || token !== this.silenceToken) return; // real activity happened since this was scheduled
    const generation = this.generation;
    await this.handleInfraScriptedPrompt("", generation);
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
    this.isOutboundDemo = call.direction === "outbound_demo";
    // Start waiting for either a reply or silence — ScamSink carries the
    // conversation forward on its own if the human doesn't respond. The
    // opening line itself was just spoken via TwiML welcomeGreeting (see
    // app/api/twilio/voice/route.ts), so estimate ITS playback time too.
    if (this.isOutboundDemo) {
      this.scheduleSilenceTimer(INFRA_OPENING_LINE);
    }
    await Promise.all([
      markCallActive(message.callSid),
      recordCallEvent(call.id, "voice_server_connected"),
    ]).catch((err) => console.error("[relay] failed to mark call active", err));
  }

  private async handlePrompt(message: TwilioInboundMessage): Promise<void> {
    const text = message.voicePrompt?.trim();
    if (!text || !this.callId || !this.callSid || !this.isOutboundDemo) return;

    const redacted = redactSensitiveNumbers(text);
    await appendTranscriptMessage(this.callId, "caller", redacted).catch((err) =>
      console.error("[relay] failed to persist caller transcript", err),
    );

    const generation = this.generation;
    await this.handleInfraScriptedPrompt(redacted, generation);
  }

  /**
   * Deterministic reply path for "CRITICAL INFRASTRUCTURE SIMULATION"
   * calls — called both reactively (a real caller prompt) and proactively
   * (handleSilenceTimeout, with an empty humanText). advanceInfraScript is
   * synchronous and pure — there is no network call here that can hang or
   * fail — but this is still wrapped defensively so that even a bug in the
   * state machine can never result in silence: `line` is always set to
   * either a scripted line or the fixed fallback, and a reply is always
   * sent (respecting the same interrupt/close checks throughout).
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
    // Reschedule from HERE, not from when this method was invoked — this
    // is what makes the window scale with THIS line's own estimated
    // playback time, whether the turn was reactive or proactive.
    this.scheduleSilenceTimer(line);

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
