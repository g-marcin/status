import { describe, expect, test } from "bun:test";
import { applyResults, classify, DAYS_MAX, emptyState, RECENT_MAX } from "./lib";

describe("classify", () => {
  test("ok and fast is up", () => {
    expect(classify(true, 100, 1500)).toEqual({ status: "up", ms: 100 });
  });
  test("ok and slow is degraded", () => {
    expect(classify(true, 2000, 1500).status).toBe("degraded");
  });
  test("not ok is down with error", () => {
    expect(classify(false, 50, 1500, "HTTP 502")).toEqual({ status: "down", ms: 50, err: "HTTP 502" });
  });
});

describe("applyResults", () => {
  test("sets current and aggregates the day", () => {
    const now = new Date("2026-10-03T10:00:00Z");
    const state = emptyState();
    applyResults(state, { api: { status: "up", ms: 100 } }, now);
    applyResults(state, { api: { status: "down", ms: 8000, err: "timeout" } }, now);

    const api = state.components.api!;
    expect(api.current.status).toBe("down");
    expect(api.recent).toHaveLength(2);
    expect(api.days["2026-10-03"]).toEqual({ up: 1, degraded: 0, down: 1, msSum: 8100 });
    expect(state.updated).toBe(now.toISOString());
  });

  test("recent is capped, oldest evicted", () => {
    const state = emptyState();
    const start = Date.parse("2026-10-03T00:00:00Z");
    for (let i = 0; i < RECENT_MAX + 10; i++) {
      applyResults(state, { api: { status: "up", ms: i } }, new Date(start + i * 1000));
    }
    const recent = state.components.api!.recent;
    expect(recent).toHaveLength(RECENT_MAX);
    expect(recent[0]!.ms).toBe(10);
  });

  test("days are capped, oldest evicted", () => {
    const state = emptyState();
    const start = Date.parse("2026-01-01T12:00:00Z");
    for (let d = 0; d < DAYS_MAX + 5; d++) {
      applyResults(state, { api: { status: "up", ms: 1 } }, new Date(start + d * 86_400_000));
    }
    const days = Object.keys(state.components.api!.days).sort();
    expect(days).toHaveLength(DAYS_MAX);
    expect(days[0]).toBe("2026-01-06");
  });
});
