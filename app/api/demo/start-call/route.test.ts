import { describe, expect, it, vi, beforeEach } from "vitest";

const { createCallMock, getActiveCallMock, twilioCallsCreateMock, twilioFactoryMock } = vi.hoisted(() => {
  const twilioCallsCreateMock = vi.fn();
  const twilioFactoryMock = vi.fn(() => ({ calls: { create: twilioCallsCreateMock } }));
  return {
    createCallMock: vi.fn(),
    getActiveCallMock: vi.fn(),
    twilioCallsCreateMock,
    twilioFactoryMock,
  };
});

vi.mock("twilio", () => ({ default: twilioFactoryMock }));
vi.mock("@/lib/calls", () => ({
  createCall: createCallMock,
  getActiveCall: getActiveCallMock,
}));
vi.mock("@/lib/env", () => ({
  getServerEnv: () => ({
    TWILIO_ACCOUNT_SID: "ACxxxx",
    TWILIO_AUTH_TOKEN: "authtoken",
    TWILIO_PHONE_NUMBER: "+12184293208",
    PUBLIC_APP_URL: "https://scamsink.example.com",
    DEMO_PHONE_NUMBER: "+447700900000",
    DEMO_OPERATOR_SECRET: "correct-horse-battery-staple",
  }),
}));

import { POST } from "./route";

const DEMO_SECRET_HEADER = "x-demo-operator-secret";

function makeRequest(secret?: string): Request {
  const headers = new Headers();
  if (secret !== undefined) headers.set(DEMO_SECRET_HEADER, secret);
  return new Request("https://scamsink.example.com/api/demo/start-call", { method: "POST", headers });
}

describe("POST /api/demo/start-call", () => {
  beforeEach(() => {
    createCallMock.mockReset().mockResolvedValue({ id: "call-1" });
    getActiveCallMock.mockReset().mockResolvedValue(null);
    twilioCallsCreateMock.mockReset().mockResolvedValue({ sid: "CAoutbound" });
    twilioFactoryMock.mockClear();
  });

  it("rejects a request with no operator secret", async () => {
    const res = await POST(makeRequest());
    expect(res.status).toBe(401);
    expect(twilioCallsCreateMock).not.toHaveBeenCalled();
  });

  it("rejects a request with the wrong operator secret", async () => {
    const res = await POST(makeRequest("wrong"));
    expect(res.status).toBe(401);
    expect(twilioCallsCreateMock).not.toHaveBeenCalled();
  });

  it("refuses to start a second call while one is already ringing or active", async () => {
    getActiveCallMock.mockResolvedValue({ id: "call-0", status: "ringing" });

    const res = await POST(makeRequest("correct-horse-battery-staple"));

    expect(res.status).toBe(409);
    expect(twilioCallsCreateMock).not.toHaveBeenCalled();
  });

  it("places the outbound call to DEMO_PHONE_NUMBER from TWILIO_PHONE_NUMBER and records it", async () => {
    const res = await POST(makeRequest("correct-horse-battery-staple"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toMatchObject({ status: "started", callSid: "CAoutbound" });
    expect(twilioCallsCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "+447700900000",
        from: "+12184293208",
        url: "https://scamsink.example.com/api/twilio/voice",
      }),
    );
    expect(createCallMock).toHaveBeenCalledWith(
      expect.objectContaining({ twilioCallSid: "CAoutbound", direction: "outbound_demo" }),
    );
  });

  it("never lets the caller control the destination number", async () => {
    // Even though nothing in the request body is read for `to`, this
    // documents the invariant: the request body is never parsed at all.
    const request = makeRequest("correct-horse-battery-staple");
    await POST(request);

    const [args] = twilioCallsCreateMock.mock.calls[0];
    expect(args.to).toBe("+447700900000");
  });

  it("returns a provider error, not a 500, when Twilio call creation fails", async () => {
    twilioCallsCreateMock.mockRejectedValue(new Error("Twilio is down"));

    const res = await POST(makeRequest("correct-horse-battery-staple"));

    expect(res.status).toBe(502);
    expect(createCallMock).not.toHaveBeenCalled();
  });
});
