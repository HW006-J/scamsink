import { describe, expect, it, vi, beforeEach } from "vitest";

const { getCallByIdMock } = vi.hoisted(() => ({ getCallByIdMock: vi.fn() }));
vi.mock("@/lib/calls", () => ({ getCallById: getCallByIdMock }));

import { GET } from "./route";

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe("GET /api/calls/[id]", () => {
  beforeEach(() => {
    getCallByIdMock.mockReset();
  });

  it("returns the call and transcript when found", async () => {
    getCallByIdMock.mockResolvedValue({
      call: { id: "call-1", status: "completed" },
      transcript: [{ id: "msg-1", speaker: "caller", content: "hi", createdAt: "2026-08-15T14:48:00.000Z" }],
    });

    const res = await GET(new Request("https://scamsink.example.com/api/calls/call-1"), makeParams("call-1"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.call.id).toBe("call-1");
    expect(body.transcript).toHaveLength(1);
  });

  it("returns 404 when the call doesn't exist", async () => {
    getCallByIdMock.mockResolvedValue(null);

    const res = await GET(new Request("https://scamsink.example.com/api/calls/missing"), makeParams("missing"));

    expect(res.status).toBe(404);
  });

  it("returns 503 on a database error", async () => {
    getCallByIdMock.mockRejectedValue(new Error("connection refused"));

    const res = await GET(new Request("https://scamsink.example.com/api/calls/call-1"), makeParams("call-1"));

    expect(res.status).toBe(503);
  });
});
