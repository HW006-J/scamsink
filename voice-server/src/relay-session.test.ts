import { describe, expect, it, vi, beforeEach } from "vitest";

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
import { RelaySession } from "./relay-session.js";

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
