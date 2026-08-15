import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

const {
  getCallByTwilioSidMock,
  markCallActiveMock,
  markCallEndedMock,
  appendTranscriptMessageMock,
  recordCallEventMock,
} = vi.hoisted(() => ({
  getCallByTwilioSidMock: vi.fn(),
  markCallActiveMock: vi.fn().mockResolvedValue(undefined),
  markCallEndedMock: vi.fn().mockResolvedValue(undefined),
  appendTranscriptMessageMock: vi.fn().mockResolvedValue(undefined),
  recordCallEventMock: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./db.js", () => ({
  getCallByTwilioSid: getCallByTwilioSidMock,
  markCallActive: markCallActiveMock,
  markCallEnded: markCallEndedMock,
  appendTranscriptMessage: appendTranscriptMessageMock,
  recordCallEvent: recordCallEventMock,
}));

import { AIProviderError, type AIProvider } from "./ai/index.js";
import { advanceInfraScript, INFRA_OPENING_LINE, INITIAL_INFRA_SCRIPT_STATE } from "./infraScript.js";
import { RelaySession } from "./relay-session.js";
import { estimatePlaybackMs, estimateProactiveDelayMs } from "./ttsTiming.js";

class FakeWebSocket {
  static readonly OPEN = 1;
  readonly OPEN = 1;
  readyState = 1;
  sent: Record<string, unknown>[] = [];
  closed = false;
  private handlers: Record<string, ((...args: unknown[]) => void)[]> = {};

  on(event: string, cb: (...args: unknown[]) => void): void {
    (this.handlers[event] ??= []).push(cb);
  }

  send(data: string): void {
    this.sent.push(JSON.parse(data));
  }

  close(): void {
    this.closed = true;
  }

  emit(event: string, ...args: unknown[]): void {
    for (const cb of this.handlers[event] ?? []) cb(...args);
  }
}

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("RelaySession", () => {
  beforeEach(() => {
    getCallByTwilioSidMock.mockReset();
    markCallActiveMock.mockReset().mockResolvedValue(undefined);
    markCallEndedMock.mockReset().mockResolvedValue(undefined);
    appendTranscriptMessageMock.mockReset().mockResolvedValue(undefined);
    recordCallEventMock.mockReset().mockResolvedValue(undefined);
  });

  it("ignores malformed (non-JSON) inbound messages without throwing", async () => {
    const ws = new FakeWebSocket();
    new RelaySession(ws as never, { streamReply: vi.fn() } as unknown as AIProvider);

    expect(() => ws.emit("message", "not json{{{")).not.toThrow();
    await flush();
  });

  it("ends the call cleanly when setup references an unknown CallSid", async () => {
    getCallByTwilioSidMock.mockResolvedValue(null);
    const ws = new FakeWebSocket();
    new RelaySession(ws as never, { streamReply: vi.fn() } as unknown as AIProvider);

    ws.emit("message", JSON.stringify({ type: "setup", callSid: "CAunknown" }));
    await flush();

    expect(ws.sent).toContainEqual({ type: "end" });
    expect(ws.closed).toBe(true);
  });

  it("streams AI tokens back as text messages and persists the transcript", async () => {
    getCallByTwilioSidMock.mockResolvedValue({ id: "call-1", status: "active", direction: "inbound" });
    const streamReply = vi.fn(async (_history, onToken: (t: string) => void) => {
      onToken("Oh dear. ");
      onToken("Which account?");
      return "Oh dear. Which account?";
    });
    const ws = new FakeWebSocket();
    new RelaySession(ws as never, { streamReply } as unknown as AIProvider);

    ws.emit("message", JSON.stringify({ type: "setup", callSid: "CAxxxx" }));
    await flush();
    ws.emit(
      "message",
      JSON.stringify({ type: "prompt", voicePrompt: "Suspicious activity on your account.", last: true }),
    );
    await flush();

    const textMessages = ws.sent.filter((m) => m.type === "text");
    expect(textMessages.length).toBeGreaterThanOrEqual(2);
    expect(textMessages[textMessages.length - 1]).toMatchObject({ last: true });
    expect(appendTranscriptMessageMock).toHaveBeenCalledWith(
      "call-1",
      "caller",
      expect.stringContaining("Suspicious activity"),
    );
    expect(appendTranscriptMessageMock).toHaveBeenCalledWith(
      "call-1",
      "scamsink",
      "Oh dear. Which account?",
    );
  });

  it("falls back to a fixed apology line and ends the call when the AI provider fails", async () => {
    getCallByTwilioSidMock.mockResolvedValue({ id: "call-1", status: "active", direction: "inbound" });
    const streamReply = vi.fn().mockRejectedValue(new AIProviderError("boom"));
    const ws = new FakeWebSocket();
    new RelaySession(ws as never, { streamReply } as unknown as AIProvider);

    ws.emit("message", JSON.stringify({ type: "setup", callSid: "CAxxxx" }));
    await flush();
    ws.emit("message", JSON.stringify({ type: "prompt", voicePrompt: "Send a gift card now.", last: true }));
    await flush();

    const textMessages = ws.sent.filter((m) => m.type === "text");
    expect(textMessages).toHaveLength(1);
    expect(textMessages[0]).toMatchObject({ last: true });
    expect(ws.sent).toContainEqual({ type: "end" });
    expect(recordCallEventMock).toHaveBeenCalledWith(
      "call-1",
      "ai_provider_error",
      expect.any(Object),
    );
  });

  it("drops a stale in-flight reply once the caller interrupts", async () => {
    getCallByTwilioSidMock.mockResolvedValue({ id: "call-1", status: "active", direction: "inbound" });
    let releaseToken: (() => void) | undefined;
    const streamReply = vi.fn(
      (_history, onToken: (t: string) => void) =>
        new Promise<string>((resolve) => {
          releaseToken = () => {
            onToken("this reply is stale");
            resolve("this reply is stale");
          };
        }),
    );
    const ws = new FakeWebSocket();
    new RelaySession(ws as never, { streamReply } as unknown as AIProvider);

    ws.emit("message", JSON.stringify({ type: "setup", callSid: "CAxxxx" }));
    await flush();
    ws.emit("message", JSON.stringify({ type: "prompt", voicePrompt: "Hello?", last: true }));
    await flush();

    // Caller talks over ScamSink before the reply finishes generating.
    ws.emit("message", JSON.stringify({ type: "interrupt" }));
    releaseToken?.();
    await flush();

    expect(ws.sent.filter((m) => m.type === "text")).toHaveLength(0);
  });

  it("bounds the history sent to the AI provider even as the call runs long", async () => {
    getCallByTwilioSidMock.mockResolvedValue({ id: "call-1", status: "active", direction: "inbound" });
    const streamReply = vi.fn(async (_history, onToken: (t: string) => void) => {
      onToken("ok");
      return "ok";
    });
    const ws = new FakeWebSocket();
    new RelaySession(ws as never, { streamReply } as unknown as AIProvider);

    ws.emit("message", JSON.stringify({ type: "setup", callSid: "CAxxxx" }));
    await flush();

    for (let i = 0; i < 25; i++) {
      ws.emit("message", JSON.stringify({ type: "prompt", voicePrompt: `turn ${i}`, last: true }));
      await flush();
    }

    expect(streamReply).toHaveBeenCalledTimes(25);
    const lastCallHistory = streamReply.mock.calls[24][0] as unknown[];
    expect(lastCallHistory.length).toBeLessThanOrEqual(20);
  });
});

describe("RelaySession — demo script mode (outbound_demo calls)", () => {
  beforeEach(() => {
    getCallByTwilioSidMock.mockReset();
    markCallActiveMock.mockReset().mockResolvedValue(undefined);
    markCallEndedMock.mockReset().mockResolvedValue(undefined);
    appendTranscriptMessageMock.mockReset().mockResolvedValue(undefined);
    recordCallEventMock.mockReset().mockResolvedValue(undefined);
  });

  it("uses the scripted line instead of calling the AI provider", async () => {
    getCallByTwilioSidMock.mockResolvedValue({ id: "call-1", status: "active", direction: "outbound_demo" });
    const streamReply = vi.fn();
    const ws = new FakeWebSocket();
    new RelaySession(ws as never, { streamReply } as unknown as AIProvider);

    ws.emit("message", JSON.stringify({ type: "setup", callSid: "CAxxxx" }));
    await flush();
    ws.emit(
      "message",
      JSON.stringify({
        type: "prompt",
        voicePrompt: "Hi, I'm calling from Microsoft, you've won £1000, do you have your credit card?",
        last: true,
      }),
    );
    await flush();

    expect(streamReply).not.toHaveBeenCalled();
    const textMessages = ws.sent.filter((m) => m.type === "text");
    expect(textMessages).toHaveLength(1);
    expect(textMessages[0]).toMatchObject({
      token: "Oh wow, really? Yeah, one second, I'll go and get it.",
      last: true,
    });
    expect(appendTranscriptMessageMock).toHaveBeenCalledWith(
      "call-1",
      "scamsink",
      "Oh wow, really? Yeah, one second, I'll go and get it.",
    );
  });

  it("advances through multiple scripted states across turns and never goes silent", async () => {
    getCallByTwilioSidMock.mockResolvedValue({ id: "call-1", status: "active", direction: "outbound_demo" });
    const streamReply = vi.fn();
    const ws = new FakeWebSocket();
    new RelaySession(ws as never, { streamReply } as unknown as AIProvider);

    ws.emit("message", JSON.stringify({ type: "setup", callSid: "CAxxxx" }));
    await flush();

    const turns = [
      "Hi, this is Microsoft, you've won a prize, do you have your card?",
      "Have you got it?",
      "Read me the card number.",
      "Sorry, what?",
      "Come on, keep going.",
      "Anything at all, gibberish nonsense",
    ];
    for (const voicePrompt of turns) {
      ws.emit("message", JSON.stringify({ type: "prompt", voicePrompt, last: true }));
      await flush();
    }

    const textMessages = ws.sent.filter((m) => m.type === "text");
    expect(textMessages).toHaveLength(turns.length);
    // Every single turn produced a non-empty spoken line — no silent turns.
    for (const msg of textMessages) {
      expect(typeof msg.token).toBe("string");
      expect((msg.token as string).length).toBeGreaterThan(0);
    }
    expect(streamReply).not.toHaveBeenCalled();
  });

  it("records demo_script_turn events for observability, without leaking transcript content", async () => {
    getCallByTwilioSidMock.mockResolvedValue({ id: "call-1", status: "active", direction: "outbound_demo" });
    const ws = new FakeWebSocket();
    new RelaySession(ws as never, { streamReply: vi.fn() } as unknown as AIProvider);

    ws.emit("message", JSON.stringify({ type: "setup", callSid: "CAxxxx" }));
    await flush();
    ws.emit("message", JSON.stringify({ type: "prompt", voicePrompt: "You've won a prize!", last: true }));
    await flush();

    expect(recordCallEventMock).toHaveBeenCalledWith(
      "call-1",
      "demo_script_turn",
      expect.objectContaining({ fromIndex: 0, toIndex: 1, matched: true }),
    );
  });

  it("persists a real completed call the same way as dynamic mode", async () => {
    getCallByTwilioSidMock.mockResolvedValue({ id: "call-1", status: "active", direction: "outbound_demo" });
    const ws = new FakeWebSocket();
    new RelaySession(ws as never, { streamReply: vi.fn() } as unknown as AIProvider);

    ws.emit("message", JSON.stringify({ type: "setup", callSid: "CAxxxx" }));
    await flush();
    ws.emit("message", JSON.stringify({ type: "prompt", voicePrompt: "Do you have your card?", last: true }));
    await flush();
    ws.emit("close");
    await flush();

    expect(markCallEndedMock).toHaveBeenCalledWith("CAxxxx", "completed");
  });

  it("drops a stale scripted reply once the caller interrupts, matching dynamic-mode behavior", async () => {
    getCallByTwilioSidMock.mockResolvedValue({ id: "call-1", status: "active", direction: "outbound_demo" });
    const releases: (() => void)[] = [];
    recordCallEventMock.mockImplementation(() => new Promise<void>((resolve) => releases.push(resolve)));

    const ws = new FakeWebSocket();
    new RelaySession(ws as never, { streamReply: vi.fn() } as unknown as AIProvider);

    ws.emit("message", JSON.stringify({ type: "setup", callSid: "CAxxxx" }));
    await flush();
    ws.emit("message", JSON.stringify({ type: "prompt", voicePrompt: "Hello?", last: true }));
    // Let handlePrompt capture `generation` and reach the (now held-open)
    // recordCallEvent call inside handleScriptedPrompt, before it sends anything.
    await flush();

    // Caller talks over ScamSink before the scripted reply is actually sent.
    ws.emit("message", JSON.stringify({ type: "interrupt" }));
    for (const release of releases.splice(0)) release();
    await flush();

    expect(ws.sent.filter((m) => m.type === "text")).toHaveLength(0);
  });
});

describe("RelaySession — infrastructure simulation mode", () => {
  beforeEach(() => {
    getCallByTwilioSidMock.mockReset();
    markCallActiveMock.mockReset().mockResolvedValue(undefined);
    markCallEndedMock.mockReset().mockResolvedValue(undefined);
    appendTranscriptMessageMock.mockReset().mockResolvedValue(undefined);
    recordCallEventMock.mockReset().mockResolvedValue(undefined);
  });

  it("uses the infra script instead of the AI provider or the scam-honeypot script", async () => {
    getCallByTwilioSidMock.mockResolvedValue({
      id: "call-1",
      status: "active",
      direction: "outbound_demo",
      demoMode: "infrastructure_simulation",
    });
    const streamReply = vi.fn();
    const ws = new FakeWebSocket();
    new RelaySession(ws as never, { streamReply } as unknown as AIProvider);

    ws.emit("message", JSON.stringify({ type: "setup", callSid: "CAxxxx" }));
    await flush();
    ws.emit("message", JSON.stringify({ type: "prompt", voicePrompt: "Yes, sure, I can help.", last: true }));
    await flush();

    expect(streamReply).not.toHaveBeenCalled();
    const textMessages = ws.sent.filter((m) => m.type === "text");
    expect(textMessages).toHaveLength(1);
    expect(textMessages[0].token).toContain("delivery information written down somewhere");
    expect(appendTranscriptMessageMock).toHaveBeenCalledWith(
      "call-1",
      "scamsink",
      expect.stringContaining("delivery information"),
    );
  });

  it("advances through multiple infra states across turns and never goes silent", async () => {
    getCallByTwilioSidMock.mockResolvedValue({
      id: "call-1",
      status: "active",
      direction: "outbound_demo",
      demoMode: "infrastructure_simulation",
    });
    const ws = new FakeWebSocket();
    new RelaySession(ws as never, { streamReply: vi.fn() } as unknown as AIProvider);

    ws.emit("message", JSON.stringify({ type: "setup", callSid: "CAxxxx" }));
    await flush();

    const turns = [
      "Yes, sounds good, where should I deliver them?",
      "How urgent is it?",
      "Do you need an invoice?",
      "What's your company name and delivery address?",
      "Okay, go on then.",
      "Anything else, gibberish nonsense",
    ];
    for (const voicePrompt of turns) {
      ws.emit("message", JSON.stringify({ type: "prompt", voicePrompt, last: true }));
      await flush();
    }

    const textMessages = ws.sent.filter((m) => m.type === "text");
    expect(textMessages).toHaveLength(turns.length);
    for (const msg of textMessages) {
      expect(typeof msg.token).toBe("string");
      expect((msg.token as string).length).toBeGreaterThan(0);
    }
  });

  it("records infra_script_turn events, distinct from demo_script_turn", async () => {
    getCallByTwilioSidMock.mockResolvedValue({
      id: "call-1",
      status: "active",
      direction: "outbound_demo",
      demoMode: "infrastructure_simulation",
    });
    const ws = new FakeWebSocket();
    new RelaySession(ws as never, { streamReply: vi.fn() } as unknown as AIProvider);

    ws.emit("message", JSON.stringify({ type: "setup", callSid: "CAxxxx" }));
    await flush();
    ws.emit("message", JSON.stringify({ type: "prompt", voicePrompt: "Yes, I can help.", last: true }));
    await flush();

    expect(recordCallEventMock).toHaveBeenCalledWith(
      "call-1",
      "infra_script_turn",
      expect.objectContaining({ intent: "CAN_HELP", phase: "DELIVERY_OPTIONS", mode: "narrative" }),
    );
  });

  it("falls back to scam_honeypot script when direction is outbound_demo with no demoMode set (legacy rows)", async () => {
    getCallByTwilioSidMock.mockResolvedValue({
      id: "call-1",
      status: "active",
      direction: "outbound_demo",
      demoMode: null,
    });
    const ws = new FakeWebSocket();
    new RelaySession(ws as never, { streamReply: vi.fn() } as unknown as AIProvider);

    ws.emit("message", JSON.stringify({ type: "setup", callSid: "CAxxxx" }));
    await flush();
    ws.emit(
      "message",
      JSON.stringify({ type: "prompt", voicePrompt: "You've won £1000, do you have your card?", last: true }),
    );
    await flush();

    const textMessages = ws.sent.filter((m) => m.type === "text");
    expect(textMessages[0]).toMatchObject({ token: "Oh wow, really? Yeah, one second, I'll go and get it." });
  });
});

describe("RelaySession — mode isolation across concurrent calls", () => {
  beforeEach(() => {
    getCallByTwilioSidMock.mockReset();
    markCallActiveMock.mockReset().mockResolvedValue(undefined);
    markCallEndedMock.mockReset().mockResolvedValue(undefined);
    appendTranscriptMessageMock.mockReset().mockResolvedValue(undefined);
    recordCallEventMock.mockReset().mockResolvedValue(undefined);
  });

  it("two simultaneous sessions in different modes never leak state into each other", async () => {
    const lookups: Record<string, unknown> = {
      CAHONEYPOT: { id: "call-honeypot", status: "active", direction: "outbound_demo", demoMode: "scam_honeypot" },
      CAINFRA: { id: "call-infra", status: "active", direction: "outbound_demo", demoMode: "infrastructure_simulation" },
      CAINBOUND: { id: "call-inbound", status: "active", direction: "inbound", demoMode: null },
    };
    getCallByTwilioSidMock.mockImplementation((sid: string) => Promise.resolve(lookups[sid] ?? null));

    const streamReply = vi.fn(async (_h, onToken: (t: string) => void) => {
      onToken("dynamic reply");
      return "dynamic reply";
    });

    const wsHoneypot = new FakeWebSocket();
    const wsInfra = new FakeWebSocket();
    const wsInbound = new FakeWebSocket();
    new RelaySession(wsHoneypot as never, { streamReply } as unknown as AIProvider);
    new RelaySession(wsInfra as never, { streamReply } as unknown as AIProvider);
    new RelaySession(wsInbound as never, { streamReply } as unknown as AIProvider);

    wsHoneypot.emit("message", JSON.stringify({ type: "setup", callSid: "CAHONEYPOT" }));
    wsInfra.emit("message", JSON.stringify({ type: "setup", callSid: "CAINFRA" }));
    wsInbound.emit("message", JSON.stringify({ type: "setup", callSid: "CAINBOUND" }));
    await flush();

    // Interleave prompts across all three sessions in the same tick.
    wsHoneypot.emit(
      "message",
      JSON.stringify({ type: "prompt", voicePrompt: "You've won £1000, do you have your card?", last: true }),
    );
    wsInfra.emit("message", JSON.stringify({ type: "prompt", voicePrompt: "Yes, I can help.", last: true }));
    wsInbound.emit("message", JSON.stringify({ type: "prompt", voicePrompt: "Hello?", last: true }));
    await flush();

    const honeypotText = wsHoneypot.sent.filter((m) => m.type === "text");
    const infraText = wsInfra.sent.filter((m) => m.type === "text");
    const inboundText = wsInbound.sent.filter((m) => m.type === "text");

    expect(honeypotText[0]).toMatchObject({ token: "Oh wow, really? Yeah, one second, I'll go and get it." });
    expect(infraText[0].token).toContain("delivery information written down somewhere");
    expect(inboundText[0]).toMatchObject({ token: "dynamic reply" });
    // The AI provider was only ever invoked for the real inbound call.
    expect(streamReply).toHaveBeenCalledTimes(1);
  });
});

describe("RelaySession — rapid speech cannot wedge the state", () => {
  beforeEach(() => {
    getCallByTwilioSidMock.mockReset();
    markCallActiveMock.mockReset().mockResolvedValue(undefined);
    markCallEndedMock.mockReset().mockResolvedValue(undefined);
    appendTranscriptMessageMock.mockReset().mockResolvedValue(undefined);
    recordCallEventMock.mockReset().mockResolvedValue(undefined);
  });

  it("firing many prompts back-to-back without waiting between them still produces one reply per turn, in order", async () => {
    getCallByTwilioSidMock.mockResolvedValue({
      id: "call-1",
      status: "active",
      direction: "outbound_demo",
      demoMode: "infrastructure_simulation",
    });
    const ws = new FakeWebSocket();
    new RelaySession(ws as never, { streamReply: vi.fn() } as unknown as AIProvider);

    ws.emit("message", JSON.stringify({ type: "setup", callSid: "CAxxxx" }));
    await flush();

    // Fire 10 prompts in immediate succession, with no await between emits.
    for (let i = 0; i < 10; i++) {
      ws.emit("message", JSON.stringify({ type: "prompt", voicePrompt: `rapid turn ${i}`, last: true }));
    }
    await flush();
    await flush();

    const textMessages = ws.sent.filter((m) => m.type === "text");
    expect(textMessages).toHaveLength(10);
    for (const msg of textMessages) {
      expect((msg.token as string).length).toBeGreaterThan(0);
    }
  });
});

describe("RelaySession — proactive silence continuation (infrastructure simulation only)", () => {
  // Real expected timings, derived from the actual production estimator and
  // actual scripted lines — never hardcoded magic numbers — so these tests
  // stay correct if line text or the timing model's constants change.
  const openingDelayMs = estimateProactiveDelayMs(INFRA_OPENING_LINE);
  const openingPlaybackMs = estimatePlaybackMs(INFRA_OPENING_LINE);
  const firstProactiveLine = advanceInfraScript(INITIAL_INFRA_SCRIPT_STATE, "").line;
  const secondProactiveDelayMs = estimateProactiveDelayMs(firstProactiveLine);
  const secondProactivePlaybackMs = estimatePlaybackMs(firstProactiveLine);

  beforeEach(() => {
    getCallByTwilioSidMock.mockReset();
    markCallActiveMock.mockReset().mockResolvedValue(undefined);
    markCallEndedMock.mockReset().mockResolvedValue(undefined);
    appendTranscriptMessageMock.mockReset().mockResolvedValue(undefined);
    recordCallEventMock.mockReset().mockResolvedValue(undefined);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function setupInfraCall(demoMode: string | null = "infrastructure_simulation") {
    getCallByTwilioSidMock.mockResolvedValue({ id: "call-1", status: "active", direction: "outbound_demo", demoMode });
    const ws = new FakeWebSocket();
    new RelaySession(ws as never, { streamReply: vi.fn() } as unknown as AIProvider);
    return ws;
  }

  it("regression: reproduces the reported bug scenario — no proactive line fires merely because estimated playback has elapsed; only after playback + the human-response grace period", async () => {
    // The opening line's own estimated playback typically runs several
    // real seconds (word-count dependent) — well short of openingDelayMs,
    // which also includes the grace period. Advancing only that far must
    // NOT produce a proactive line — reproducing the exact bug where the
    // old flat 7s timer fired mid-playback/right as TTS ended.
    const ws = setupInfraCall();
    ws.emit("message", JSON.stringify({ type: "setup", callSid: "CAxxxx" }));
    await vi.advanceTimersByTimeAsync(0);

    await vi.advanceTimersByTimeAsync(openingPlaybackMs);
    expect(ws.sent.filter((m) => m.type === "text")).toHaveLength(0);

    // Now advance through the remaining human-response grace period.
    await vi.advanceTimersByTimeAsync(openingDelayMs - openingPlaybackMs);
    const textMessages = ws.sent.filter((m) => m.type === "text");
    expect(textMessages).toHaveLength(1);
    expect(recordCallEventMock).toHaveBeenCalledWith(
      "call-1",
      "infra_script_turn",
      expect.objectContaining({ intent: "OTHER", mode: "narrative" }),
    );
  });

  it("human speaks 2 seconds after estimated TTS playback would have finished — proactive continuation is cancelled", async () => {
    const ws = setupInfraCall();
    ws.emit("message", JSON.stringify({ type: "setup", callSid: "CAxxxx" }));
    await vi.advanceTimersByTimeAsync(0);

    await vi.advanceTimersByTimeAsync(openingPlaybackMs + 2_000);
    expect(ws.sent.filter((m) => m.type === "text")).toHaveLength(0); // still within the grace window, nothing fired yet

    ws.emit("message", JSON.stringify({ type: "prompt", voicePrompt: "Sure, I can help.", last: true }));
    await vi.advanceTimersByTimeAsync(0);
    expect(ws.sent.filter((m) => m.type === "text")).toHaveLength(1); // the real reply

    // Advance well past when the original (now-cancelled) proactive timer would have fired.
    await vi.advanceTimersByTimeAsync(openingDelayMs);
    expect(ws.sent.filter((m) => m.type === "text")).toHaveLength(1); // no extra overlapping proactive line
  });

  it("human interrupts while TTS is still (estimated to be) playing — proactive continuation is cancelled", async () => {
    const ws = setupInfraCall();
    ws.emit("message", JSON.stringify({ type: "setup", callSid: "CAxxxx" }));
    await vi.advanceTimersByTimeAsync(0);

    // Interrupt mid-playback, well before the estimated playback window ends.
    await vi.advanceTimersByTimeAsync(Math.floor(openingPlaybackMs / 2));
    ws.emit("message", JSON.stringify({ type: "interrupt", utteranceUntilInterrupt: "wait", durationUntilInterruptMs: 100 }));
    await vi.advanceTimersByTimeAsync(0);

    await vi.advanceTimersByTimeAsync(openingDelayMs);
    expect(ws.sent.filter((m) => m.type === "text")).toHaveLength(0); // never fired
  });

  it("a proactive line cannot immediately trigger another proactive line — the same playback+grace rule applies again", async () => {
    const ws = setupInfraCall();
    ws.emit("message", JSON.stringify({ type: "setup", callSid: "CAxxxx" }));
    await vi.advanceTimersByTimeAsync(0);

    await vi.advanceTimersByTimeAsync(openingDelayMs);
    expect(ws.sent.filter((m) => m.type === "text")).toHaveLength(1); // first proactive line

    // Advance only through the SECOND proactive line's own estimated
    // playback (not yet its grace period) — must not have fired again.
    await vi.advanceTimersByTimeAsync(secondProactivePlaybackMs);
    expect(ws.sent.filter((m) => m.type === "text")).toHaveLength(1);

    // Now advance through its grace period too.
    await vi.advanceTimersByTimeAsync(secondProactiveDelayMs - secondProactivePlaybackMs);
    expect(ws.sent.filter((m) => m.type === "text")).toHaveLength(2);
  });

  it("30+ seconds of complete silence produces spaced, natural continuation beats — never back-to-back TTS", async () => {
    const ws = setupInfraCall();
    ws.emit("message", JSON.stringify({ type: "setup", callSid: "CAxxxx" }));
    await vi.advanceTimersByTimeAsync(0);

    const countsOverTime: number[] = [];
    let elapsed = 0;
    const stepMs = 1_000;
    while (elapsed < 32_000) {
      await vi.advanceTimersByTimeAsync(stepMs);
      elapsed += stepMs;
      countsOverTime.push(ws.sent.filter((m) => m.type === "text").length);
    }

    const finalCount = countsOverTime[countsOverTime.length - 1];
    expect(finalCount).toBeGreaterThanOrEqual(2); // multiple beats happened over 32s of silence

    // Never more than one NEW proactive line within any single 1s sampling
    // step — i.e. counts increase by at most 1 per step, confirming beats
    // are spaced out rather than firing back-to-back in a burst.
    for (let i = 1; i < countsOverTime.length; i++) {
      expect(countsOverTime[i] - countsOverTime[i - 1]).toBeLessThanOrEqual(1);
    }
  });

  it("at most one silence timer is ever pending, even if scheduling is triggered repeatedly", async () => {
    const ws = setupInfraCall();
    ws.emit("message", JSON.stringify({ type: "setup", callSid: "CAxxxx" }));
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBeLessThanOrEqual(1);

    // A burst of real prompts, each of which reschedules — still only one
    // timer pending afterward, never an accumulating pile of stale timers.
    for (let i = 0; i < 5; i++) {
      ws.emit("message", JSON.stringify({ type: "prompt", voicePrompt: `turn ${i}`, last: true }));
      await vi.advanceTimersByTimeAsync(0);
    }
    expect(vi.getTimerCount()).toBeLessThanOrEqual(1);
  });

  it("never fires a proactive continuation for scam_honeypot mode", async () => {
    const ws = setupInfraCall("scam_honeypot");
    ws.emit("message", JSON.stringify({ type: "setup", callSid: "CAxxxx" }));
    await vi.advanceTimersByTimeAsync(openingDelayMs * 2);

    expect(ws.sent.filter((m) => m.type === "text")).toHaveLength(0);
  });

  it("never fires a proactive continuation for real inbound (dynamic Groq) calls", async () => {
    getCallByTwilioSidMock.mockResolvedValue({ id: "call-1", status: "active", direction: "inbound", demoMode: null });
    const ws = new FakeWebSocket();
    new RelaySession(ws as never, { streamReply: vi.fn() } as unknown as AIProvider);

    ws.emit("message", JSON.stringify({ type: "setup", callSid: "CAxxxx" }));
    await vi.advanceTimersByTimeAsync(openingDelayMs * 2);

    expect(ws.sent.filter((m) => m.type === "text")).toHaveLength(0);
  });

  it("stops scheduling further proactive turns once the call closes", async () => {
    const ws = setupInfraCall();
    ws.emit("message", JSON.stringify({ type: "setup", callSid: "CAxxxx" }));
    await vi.advanceTimersByTimeAsync(0);

    ws.emit("close");
    await vi.advanceTimersByTimeAsync(openingDelayMs * 3);

    expect(ws.sent.filter((m) => m.type === "text")).toHaveLength(0);
  });
});
