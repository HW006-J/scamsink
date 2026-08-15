import { describe, expect, it, vi, beforeEach } from "vitest";

const { createCallMock, readVerifiedTwilioRequestMock, InvalidTwilioSignatureError } = vi.hoisted(() => {
  class InvalidTwilioSignatureError extends Error {}
  return {
    createCallMock: vi.fn(),
    readVerifiedTwilioRequestMock: vi.fn(),
    InvalidTwilioSignatureError,
  };
});

vi.mock("@/lib/twilioAuth", () => ({
  InvalidTwilioSignatureError,
  readVerifiedTwilioRequest: readVerifiedTwilioRequestMock,
}));
vi.mock("@/lib/calls", () => ({ createCall: createCallMock }));
vi.mock("@/lib/env", () => ({
  getServerEnv: () => ({
    VOICE_SERVER_URL: "wss://voice.example.com/relay",
    VOICE_SERVER_SHARED_SECRET: "test-shared-secret-please-ignore",
  }),
}));

import { POST } from "./route";

function makeRequest(body: string): Request {
  return new Request("https://scamsink.example.com/api/twilio/voice", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
}

describe("POST /api/twilio/voice", () => {
  beforeEach(() => {
    createCallMock.mockReset();
    readVerifiedTwilioRequestMock.mockReset();
  });

  it("rejects a request with an invalid Twilio signature", async () => {
    readVerifiedTwilioRequestMock.mockRejectedValue(new InvalidTwilioSignatureError());

    const res = await POST(makeRequest("CallSid=CAxxxx&From=%2B15551234567"));

    expect(res.status).toBe(403);
    expect(createCallMock).not.toHaveBeenCalled();
  });

  it("rejects a malformed webhook missing CallSid", async () => {
    readVerifiedTwilioRequestMock.mockResolvedValue({ From: "+15551234567" });

    const res = await POST(makeRequest("From=%2B15551234567"));

    expect(res.status).toBe(400);
    expect(createCallMock).not.toHaveBeenCalled();
  });

  it("creates a call and returns ConversationRelay TwiML for a valid request", async () => {
    readVerifiedTwilioRequestMock.mockResolvedValue({
      CallSid: "CAxxxx",
      From: "+15551234567",
    });
    createCallMock.mockResolvedValue({ id: "call-id-1" });

    const res = await POST(makeRequest("CallSid=CAxxxx&From=%2B15551234567"));
    const xml = await res.text();

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/xml");
    expect(xml).toContain("<ConversationRelay");
    expect(xml).toContain("wss://voice.example.com/relay");
    expect(createCallMock).toHaveBeenCalledWith(
      expect.objectContaining({ twilioCallSid: "CAxxxx" }),
    );
  });

  it("fails the call cleanly (TwiML, not a 500) if the database write fails", async () => {
    readVerifiedTwilioRequestMock.mockResolvedValue({
      CallSid: "CAxxxx",
      From: "+15551234567",
    });
    createCallMock.mockRejectedValue(new Error("database unavailable"));

    const res = await POST(makeRequest("CallSid=CAxxxx&From=%2B15551234567"));
    const xml = await res.text();

    expect(res.status).toBe(200);
    expect(xml).toContain("<Hangup");
    expect(xml).not.toContain("ConversationRelay");
  });
});
