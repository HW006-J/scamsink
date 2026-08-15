import { describe, expect, it, vi, beforeEach } from "vitest";

const { getCallByTwilioSidMock, readVerifiedTwilioRequestMock, InvalidTwilioSignatureError } = vi.hoisted(() => {
  class InvalidTwilioSignatureError extends Error {}
  return {
    getCallByTwilioSidMock: vi.fn(),
    readVerifiedTwilioRequestMock: vi.fn(),
    InvalidTwilioSignatureError,
  };
});

vi.mock("@/lib/twilioAuth", () => ({
  InvalidTwilioSignatureError,
  readVerifiedTwilioRequest: readVerifiedTwilioRequestMock,
}));
vi.mock("@/lib/calls", () => ({
  getCallByTwilioSid: getCallByTwilioSidMock,
}));
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
    getCallByTwilioSidMock.mockReset().mockResolvedValue(null);
    readVerifiedTwilioRequestMock.mockReset();
  });

  it("rejects a request with an invalid Twilio signature", async () => {
    readVerifiedTwilioRequestMock.mockRejectedValue(new InvalidTwilioSignatureError());

    const res = await POST(makeRequest("CallSid=CAxxxx&From=%2B15551234567"));

    expect(res.status).toBe(403);
  });

  it("rejects a malformed webhook missing CallSid", async () => {
    readVerifiedTwilioRequestMock.mockResolvedValue({ From: "+15551234567" });

    const res = await POST(makeRequest("From=%2B15551234567"));

    expect(res.status).toBe(400);
  });

  // The scam-honeypot mode and the real inbound engagement flow have both
  // been removed. Any call whose row wasn't pre-created by
  // /api/demo/start-call — most notably a genuine new inbound call to the
  // Twilio number — now gets a safe, non-interactive hangup instead of ever
  // touching ConversationRelay, the voice server, or the database.
  describe("unrecognized call (no pre-created row) — safe hangup path", () => {
    it("returns a Say+Hangup response, never ConversationRelay, for a genuine new inbound call", async () => {
      getCallByTwilioSidMock.mockResolvedValue(null);
      readVerifiedTwilioRequestMock.mockResolvedValue({
        CallSid: "CAinbound",
        From: "+15551234567",
        To: "+12184293208",
        Direction: "inbound",
      });

      const res = await POST(makeRequest("CallSid=CAinbound"));
      const xml = await res.text();

      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/xml");
      expect(xml).toContain("<Say>");
      expect(xml).toContain("<Hangup");
      expect(xml).not.toContain("ConversationRelay");
      expect(xml).not.toContain("Hi, I need some parts urgently");
    });

    it("never creates a database row for an unrecognized call", async () => {
      getCallByTwilioSidMock.mockResolvedValue(null);
      readVerifiedTwilioRequestMock.mockResolvedValue({ CallSid: "CAinbound", From: "+15551234567" });

      await POST(makeRequest("CallSid=CAinbound"));

      // No createCall import exists in this route at all any more — if the
      // route tried to call it, this mock module would throw on import.
      expect(getCallByTwilioSidMock).toHaveBeenCalledWith("CAinbound");
    });

    it("returns the same safe hangup even if the database lookup itself fails", async () => {
      getCallByTwilioSidMock.mockRejectedValue(new Error("connection refused"));
      readVerifiedTwilioRequestMock.mockResolvedValue({ CallSid: "CAxxxx", From: "+15551234567" });

      const res = await POST(makeRequest("CallSid=CAxxxx"));
      const xml = await res.text();

      expect(res.status).toBe(200);
      expect(xml).toContain("<Hangup");
      expect(xml).not.toContain("ConversationRelay");
    });
  });

  describe("recognized outbound demo call (row pre-created by /api/demo/start-call)", () => {
    it("connects to ConversationRelay with the infrastructure-simulation opening line as welcomeGreeting", async () => {
      getCallByTwilioSidMock.mockResolvedValue({ id: "existing-call-id", status: "ringing" });
      readVerifiedTwilioRequestMock.mockResolvedValue({
        CallSid: "CAinfra",
        From: "+12184293208",
        To: "+447700900000",
        Direction: "outbound-api",
      });

      const res = await POST(makeRequest("CallSid=CAinfra"));
      const xml = await res.text();

      expect(res.status).toBe(200);
      expect(xml).toContain("<ConversationRelay");
      expect(xml).toContain("wss://voice.example.com/relay");
      expect(xml).toContain("welcomeGreeting=");
      expect(xml).toContain("Hi, I need some parts urgently to repair five drones");
    });

    it("does not create a new row — the pre-created one from /api/demo/start-call is used as-is", async () => {
      getCallByTwilioSidMock.mockResolvedValue({ id: "existing-call-id", status: "ringing" });
      readVerifiedTwilioRequestMock.mockResolvedValue({
        CallSid: "CAoutbound",
        From: "+12184293208",
        To: "+447700900000",
        Direction: "outbound-api",
      });

      const res = await POST(makeRequest("CallSid=CAoutbound"));

      expect(res.status).toBe(200);
      expect(getCallByTwilioSidMock).toHaveBeenCalledWith("CAoutbound");
    });
  });
});
