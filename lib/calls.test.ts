import { describe, expect, it, vi, beforeEach } from "vitest";

const { queryMock, queryOneMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
  queryOneMock: vi.fn(),
}));

vi.mock("./db", () => ({ query: queryMock, queryOne: queryOneMock }));

import {
  getCallById,
  getDashboardMetrics,
  getMostRecentDemoCallCreatedAt,
  getRecentCalls,
  getSimulationMetrics,
} from "./calls";

describe("getDashboardMetrics", () => {
  beforeEach(() => {
    queryOneMock.mockReset();
  });

  it("computes totals, average, and turns from completed calls only", async () => {
    queryOneMock
      .mockResolvedValueOnce({ total_calls: 6, total_time_wasted_seconds: 276 })
      .mockResolvedValueOnce({ total_turns: 31 });

    const metrics = await getDashboardMetrics();

    expect(metrics).toEqual({
      totalCalls: 6,
      totalTimeWastedSeconds: 276,
      averageCallSeconds: 46,
      totalTurns: 31,
    });
  });

  it("excludes infrastructure_simulation calls from the query", async () => {
    queryOneMock
      .mockResolvedValueOnce({ total_calls: 0, total_time_wasted_seconds: 0 })
      .mockResolvedValueOnce({ total_turns: 0 });

    await getDashboardMetrics();

    expect(queryOneMock).toHaveBeenNthCalledWith(1, expect.stringContaining("infrastructure_simulation"));
    expect(queryOneMock).toHaveBeenNthCalledWith(2, expect.stringContaining("infrastructure_simulation"));
  });

  it("returns all-zero metrics when there are no completed calls", async () => {
    queryOneMock
      .mockResolvedValueOnce({ total_calls: 0, total_time_wasted_seconds: 0 })
      .mockResolvedValueOnce({ total_turns: 0 });

    const metrics = await getDashboardMetrics();

    expect(metrics).toEqual({
      totalCalls: 0,
      totalTimeWastedSeconds: 0,
      averageCallSeconds: 0,
      totalTurns: 0,
    });
  });

  it("tolerates a null row from the aggregate query", async () => {
    queryOneMock.mockResolvedValueOnce(null).mockResolvedValueOnce(null);

    const metrics = await getDashboardMetrics();

    expect(metrics).toEqual({
      totalCalls: 0,
      totalTimeWastedSeconds: 0,
      averageCallSeconds: 0,
      totalTurns: 0,
    });
  });
});

describe("getSimulationMetrics", () => {
  beforeEach(() => {
    queryOneMock.mockReset();
  });

  it("computes totals scoped to infrastructure_simulation calls only", async () => {
    queryOneMock
      .mockResolvedValueOnce({ total_calls: 2, total_time_wasted_seconds: 202 })
      .mockResolvedValueOnce({ total_turns: 10 });

    const metrics = await getSimulationMetrics();

    expect(metrics).toEqual({
      totalCalls: 2,
      totalTimeWastedSeconds: 202,
      averageCallSeconds: 101,
      totalTurns: 10,
    });
    expect(queryOneMock).toHaveBeenNthCalledWith(1, expect.stringContaining("demo_mode = 'infrastructure_simulation'"));
  });

  it("returns all-zero metrics when there are no simulation calls yet (never fakes numbers)", async () => {
    queryOneMock
      .mockResolvedValueOnce({ total_calls: 0, total_time_wasted_seconds: 0 })
      .mockResolvedValueOnce({ total_turns: 0 });

    const metrics = await getSimulationMetrics();

    expect(metrics).toEqual({ totalCalls: 0, totalTimeWastedSeconds: 0, averageCallSeconds: 0, totalTurns: 0 });
  });
});

describe("getRecentCalls", () => {
  beforeEach(() => {
    queryMock.mockReset();
  });

  it("maps rows to history items with turn counts", async () => {
    queryMock.mockResolvedValueOnce([
      {
        id: "call-1",
        twilio_call_sid: "CA1",
        status: "completed",
        direction: "outbound_demo",
        demo_mode: "infrastructure_simulation",
        caller_number_masked: "+44 **** **60",
        started_at: new Date("2026-08-15T14:48:00.000Z"),
        ended_at: new Date("2026-08-15T14:48:32.000Z"),
        duration_seconds: 32,
        persona: "default",
        created_at: new Date("2026-08-15T14:47:55.000Z"),
        turns: 5,
      },
    ]);

    const history = await getRecentCalls();

    expect(history).toEqual([
      {
        id: "call-1",
        status: "completed",
        direction: "outbound_demo",
        demoMode: "infrastructure_simulation",
        callerNumberMasked: "+44 **** **60",
        startedAt: "2026-08-15T14:48:00.000Z",
        endedAt: "2026-08-15T14:48:32.000Z",
        durationSeconds: 32,
        persona: "default",
        turns: 5,
        createdAt: "2026-08-15T14:47:55.000Z",
      },
    ]);
    expect(queryMock).toHaveBeenCalledWith(expect.stringContaining("limit $1"), [10]);
  });

  it("respects a custom limit", async () => {
    queryMock.mockResolvedValueOnce([]);
    await getRecentCalls(3);
    expect(queryMock).toHaveBeenCalledWith(expect.any(String), [3]);
  });
});

describe("getCallById", () => {
  beforeEach(() => {
    queryOneMock.mockReset();
    queryMock.mockReset();
  });

  it("returns null when the call doesn't exist", async () => {
    queryOneMock.mockResolvedValueOnce(null);
    const result = await getCallById("missing-id");
    expect(result).toBeNull();
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("returns the call snapshot with its transcript", async () => {
    queryOneMock.mockResolvedValueOnce({
      id: "call-1",
      twilio_call_sid: "CA1",
      status: "completed",
      direction: "outbound_demo",
      demo_mode: "scam_honeypot",
      caller_number_masked: "+44 **** **60",
      started_at: new Date("2026-08-15T14:48:00.000Z"),
      ended_at: new Date("2026-08-15T14:48:32.000Z"),
      duration_seconds: 32,
      persona: "default",
    });
    queryMock.mockResolvedValueOnce([
      {
        id: "msg-1",
        speaker: "caller",
        content: "Hello?",
        created_at: new Date("2026-08-15T14:48:01.000Z"),
      },
    ]);

    const result = await getCallById("call-1");

    expect(result).toEqual({
      call: {
        id: "call-1",
        status: "completed",
        direction: "outbound_demo",
        demoMode: "scam_honeypot",
        callerNumberMasked: "+44 **** **60",
        startedAt: "2026-08-15T14:48:00.000Z",
        endedAt: "2026-08-15T14:48:32.000Z",
        durationSeconds: 32,
        persona: "default",
      },
      transcript: [
        { id: "msg-1", speaker: "caller", content: "Hello?", createdAt: "2026-08-15T14:48:01.000Z" },
      ],
    });
  });
});

describe("getMostRecentDemoCallCreatedAt", () => {
  beforeEach(() => {
    queryOneMock.mockReset();
  });

  it("returns the created_at of the most recent outbound_demo call", async () => {
    const createdAt = new Date("2026-08-15T14:47:00.000Z");
    queryOneMock.mockResolvedValueOnce({ created_at: createdAt });

    const result = await getMostRecentDemoCallCreatedAt();

    expect(result).toEqual(createdAt);
    expect(queryOneMock).toHaveBeenCalledWith(expect.stringContaining("outbound_demo"));
  });

  it("returns null when there are no demo calls yet", async () => {
    queryOneMock.mockResolvedValueOnce(null);
    const result = await getMostRecentDemoCallCreatedAt();
    expect(result).toBeNull();
  });
});
