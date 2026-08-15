import { describe, expect, it, vi, beforeEach } from "vitest";

const {
  createCallMock,
  getActiveCallMock,
  getMostRecentDemoCallCreatedAtMock,
  twilioCallsCreateMock,
  twilioFactoryMock,
} = vi.hoisted(() => {
  const twilioCallsCreateMock = vi.fn();
  const twilioFactoryMock = vi.fn(() => ({ calls: { create: twilioCallsCreateMock } }));
  return {
    createCallMock: vi.fn(),
    getActiveCallMock: vi.fn(),
    getMostRecentDemoCallCreatedAtMock: vi.fn(),
    twilioCallsCreateMock,
    twilioFactoryMock,
  };
});

vi.mock("twilio", () => ({ default: twilioFactoryMock }));
vi.mock("@/lib/calls", () => ({
  createCall: createCallMock,
  getActiveCall: getActiveCallMock,
  getMostRecentDemoCallCreatedAt: getMostRecentDemoCallCreatedAtMock,
}));
vi.mock("@/lib/env", () => ({
  getServerEnv: () => ({
    TWILIO_ACCOUNT_SID: "ACxxxx",
    TWILIO_AUTH_TOKEN: "authtoken",
    TWILIO_PHONE_NUMBER: "+12184293208",
    PUBLIC_APP_URL: "https://scamsink.example.com",
    DEMO_PHONE_NUMBER: "+447700900000",
    DEMO_OPERATOR_SECRET: "correct-horse-battery-staple",
    DEMO_ALLOWED_PHONE_NUMBERS: "+447940757160",
  }),
}));

import { POST } from "./route";

const DEMO_SECRET_HEADER = "x-demo-operator-secret";

function makeRequest(secret?: string, body?: unknown): Request {
  const headers = new Headers();
  if (secret !== undefined) headers.set(DEMO_SECRET_HEADER, secret);
  if (body !== undefined) headers.set("content-type", "application/json");
  return new Request("https://scamsink.example.com/api/demo/start-call", {
    method: "POST",
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

describe("POST /api/demo/start-call", () => {
  beforeEach(() => {
    createCallMock.mockReset().mockResolvedValue({ id: "call-1" });
    getActiveCallMock.mockReset().mockResolvedValue(null);
    getMostRecentDemoCallCreatedAtMock.mockReset().mockResolvedValue(null);
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

  it("defaults to DEMO_PHONE_NUMBER when no body is sent, and places the call", async () => {
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

  it("accepts a destination on the allowlist, normalizing it to E.164 first", async () => {
    const res = await POST(makeRequest("correct-horse-battery-staple", { to: "07940 757160" }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toMatchObject({ status: "started" });
    expect(twilioCallsCreateMock).toHaveBeenCalledWith(expect.objectContaining({ to: "+447940757160" }));
  });

  it("rejects a destination not on the allowlist", async () => {
    const res = await POST(makeRequest("correct-horse-battery-staple", { to: "+447700900999" }));
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.error).toBe("NUMBER_NOT_ALLOWED");
    expect(twilioCallsCreateMock).not.toHaveBeenCalled();
  });

  it("rejects an unparseable phone number", async () => {
    const res = await POST(makeRequest("correct-horse-battery-staple", { to: "not a number" }));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe("INVALID_NUMBER");
    expect(twilioCallsCreateMock).not.toHaveBeenCalled();
  });

  it("never lets the caller inject extra Twilio call parameters via the body", async () => {
    const request = makeRequest("correct-horse-battery-staple", {
      to: "+447940757160",
      from: "+19998887777",
      url: "https://evil.example.com",
    });
    await POST(request);

    const [args] = twilioCallsCreateMock.mock.calls[0];
    expect(args.from).toBe("+12184293208");
    expect(args.url).toBe("https://scamsink.example.com/api/twilio/voice");
  });

  it("rejects a new call within the rate-limit cooldown of the last one", async () => {
    getMostRecentDemoCallCreatedAtMock.mockResolvedValue(new Date(Date.now() - 5_000));

    const res = await POST(makeRequest("correct-horse-battery-staple"));
    const body = await res.json();

    expect(res.status).toBe(429);
    expect(body.error).toBe("RATE_LIMITED");
    expect(twilioCallsCreateMock).not.toHaveBeenCalled();
  });

  it("allows a new call once the rate-limit cooldown has elapsed", async () => {
    getMostRecentDemoCallCreatedAtMock.mockResolvedValue(new Date(Date.now() - 60_000));

    const res = await POST(makeRequest("correct-horse-battery-staple"));

    expect(res.status).toBe(200);
    expect(twilioCallsCreateMock).toHaveBeenCalled();
  });

  it("returns a provider error, not a 500, when Twilio call creation fails", async () => {
    twilioCallsCreateMock.mockRejectedValue(new Error("Twilio is down"));

    const res = await POST(makeRequest("correct-horse-battery-staple"));

    expect(res.status).toBe(502);
    expect(createCallMock).not.toHaveBeenCalled();
  });
});
