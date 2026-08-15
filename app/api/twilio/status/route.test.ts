import { describe, expect, it, vi, beforeEach } from "vitest";

const {
  getCallByTwilioSidMock,
  markCallActiveMock,
  markCallEndedMock,
  recordCallEventMock,
  readVerifiedTwilioRequestMock,
  InvalidTwilioSignatureError,
} = vi.hoisted(() => {
  class InvalidTwilioSignatureError extends Error {}
  return {
    getCallByTwilioSidMock: vi.fn(),
    markCallActiveMock: vi.fn(),
    markCallEndedMock: vi.fn(),
    recordCallEventMock: vi.fn(),
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
  markCallActive: markCallActiveMock,
  markCallEnded: markCallEndedMock,
  recordCallEvent: recordCallEventMock,
}));

import { POST } from "./route";

function makeRequest(body: string): Request {
  return new Request("https://scamsink.example.com/api/twilio/status", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
}

describe("POST /api/twilio/status", () => {
  beforeEach(() => {
    getCallByTwilioSidMock.mockReset().mockResolvedValue({ id: "call-id-1", status: "active" });
    markCallActiveMock.mockReset();
    markCallEndedMock.mockReset();
    recordCallEventMock.mockReset();
    readVerifiedTwilioRequestMock.mockReset();
  });

  it("rejects a request with an invalid Twilio signature", async () => {
    readVerifiedTwilioRequestMock.mockRejectedValue(new InvalidTwilioSignatureError());

    const res = await POST(makeRequest("CallSid=CAxxxx&CallStatus=completed"));

    expect(res.status).toBe(403);
    expect(markCallEndedMock).not.toHaveBeenCalled();
  });

  it("rejects a malformed callback missing CallStatus", async () => {
    readVerifiedTwilioRequestMock.mockResolvedValue({ CallSid: "CAxxxx" });

    const res = await POST(makeRequest("CallSid=CAxxxx"));

    expect(res.status).toBe(400);
  });

  it("marks the call active on in-progress", async () => {
    readVerifiedTwilioRequestMock.mockResolvedValue({ CallSid: "CAxxxx", CallStatus: "in-progress" });

    await POST(makeRequest("CallSid=CAxxxx&CallStatus=in-progress"));

    expect(markCallActiveMock).toHaveBeenCalledWith("CAxxxx");
    expect(markCallEndedMock).not.toHaveBeenCalled();
  });

  it("marks the call completed on completed", async () => {
    readVerifiedTwilioRequestMock.mockResolvedValue({ CallSid: "CAxxxx", CallStatus: "completed" });

    await POST(makeRequest("CallSid=CAxxxx&CallStatus=completed"));

    expect(markCallEndedMock).toHaveBeenCalledWith("CAxxxx", "completed");
  });

  it.each(["busy", "failed", "no-answer", "canceled"])(
    "marks the call failed on %s",
    async (callStatus) => {
      readVerifiedTwilioRequestMock.mockResolvedValue({ CallSid: "CAxxxx", CallStatus: callStatus });

      await POST(makeRequest(`CallSid=CAxxxx&CallStatus=${callStatus}`));

      expect(markCallEndedMock).toHaveBeenCalledWith("CAxxxx", "failed");
    },
  );

  it("handles duplicate callbacks for the same status idempotently (no throw, called each time)", async () => {
    readVerifiedTwilioRequestMock.mockResolvedValue({ CallSid: "CAxxxx", CallStatus: "completed" });

    const first = await POST(makeRequest("CallSid=CAxxxx&CallStatus=completed"));
    const second = await POST(makeRequest("CallSid=CAxxxx&CallStatus=completed"));

    expect(first.status).toBe(204);
    expect(second.status).toBe(204);
    expect(markCallEndedMock).toHaveBeenCalledTimes(2);
  });

  it("still returns 200-class response if the database write fails, to avoid Twilio retry storms", async () => {
    readVerifiedTwilioRequestMock.mockResolvedValue({ CallSid: "CAxxxx", CallStatus: "completed" });
    markCallEndedMock.mockRejectedValue(new Error("database unavailable"));

    const res = await POST(makeRequest("CallSid=CAxxxx&CallStatus=completed"));

    expect(res.status).toBe(204);
  });
});
