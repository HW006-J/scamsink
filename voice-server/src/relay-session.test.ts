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
    getCallByTwilioSidMock.mockResolvedValue({ id: "call-1", status: "active" });
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
    getCallByTwilioSidMock.mockResolvedValue({ id: "call-1", status: "active" });
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
    getCallByTwilioSidMock.mockResolvedValue({ id: "call-1", status: "active" });
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
});
