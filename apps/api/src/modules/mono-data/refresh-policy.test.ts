import { describe, expect, it } from "vitest";
import { consecutiveFailures, decideRefresh, type RefreshPolicyInput } from "./refresh-policy";

const NOW = new Date("2026-09-22T12:00:00Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000);
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000);

const base: RefreshPolicyInput = {
  trigger: "admin",
  now: NOW,
  lastSyncedAt: null,
  lastSyncAttemptAt: null,
  lastSyncStatus: null,
  consecutiveFailures: 0,
};

describe("decideRefresh — admin trigger", () => {
  it("always refreshes a customer never synced before", () => {
    expect(decideRefresh(base)).toEqual({ shouldRefresh: true, reason: "never_synced", retryAfterSeconds: null });
  });

  it("refreshes fresh data too — a human override, not a freshness gate", () => {
    const d = decideRefresh({ ...base, lastSyncedAt: hoursAgo(1), lastSyncAttemptAt: hoursAgo(1) });
    expect(d).toEqual({ shouldRefresh: true, reason: "fresh", retryAfterSeconds: null });
  });

  it("refreshes stale data, reason 'stale'", () => {
    const d = decideRefresh({ ...base, lastSyncedAt: hoursAgo(30), lastSyncAttemptAt: hoursAgo(30) });
    expect(d).toEqual({ shouldRefresh: true, reason: "stale", retryAfterSeconds: null });
  });

  it("declines a second click moments after the first, with a wait time", () => {
    const d = decideRefresh({ ...base, lastSyncAttemptAt: minutesAgo(1) });
    expect(d.shouldRefresh).toBe(false);
    expect(d.reason).toBe("too_soon_since_attempt");
    expect(d.retryAfterSeconds).toBeGreaterThan(0);
    expect(d.retryAfterSeconds).toBeLessThanOrEqual(240);
  });

  it("allows a click again once the gap has passed", () => {
    const d = decideRefresh({ ...base, lastSyncAttemptAt: minutesAgo(6) });
    expect(d.shouldRefresh).toBe(true);
  });

  it("ignores consecutiveFailures entirely — a human retry isn't backed off", () => {
    const d = decideRefresh({ ...base, lastSyncAttemptAt: minutesAgo(6), lastSyncStatus: "failed", consecutiveFailures: 5 });
    expect(d.shouldRefresh).toBe(true);
  });
});

describe("decideRefresh — system trigger", () => {
  const sys: RefreshPolicyInput = { ...base, trigger: "system" };

  it("refreshes a customer never synced before", () => {
    expect(decideRefresh(sys)).toEqual({ shouldRefresh: true, reason: "never_synced", retryAfterSeconds: null });
  });

  it("declines fresh data, with the time until it goes stale", () => {
    const d = decideRefresh({ ...sys, lastSyncedAt: hoursAgo(1), lastSyncAttemptAt: hoursAgo(1), lastSyncStatus: "success" });
    expect(d.shouldRefresh).toBe(false);
    expect(d.reason).toBe("fresh");
    // 23 hours left of the default 24h window, give or take rounding.
    expect(d.retryAfterSeconds).toBeGreaterThan(22 * 3600);
    expect(d.retryAfterSeconds).toBeLessThanOrEqual(23 * 3600);
  });

  it("refreshes once data crosses the freshness window", () => {
    const d = decideRefresh({ ...sys, lastSyncedAt: hoursAgo(25), lastSyncAttemptAt: hoursAgo(25), lastSyncStatus: "success" });
    expect(d).toEqual({ shouldRefresh: true, reason: "stale", retryAfterSeconds: null });
  });

  it("respects a custom freshness window", () => {
    const d = decideRefresh({ ...sys, lastSyncedAt: hoursAgo(2), lastSyncAttemptAt: hoursAgo(2), lastSyncStatus: "success", freshForHours: 1 });
    expect(d.shouldRefresh).toBe(true);
    expect(d.reason).toBe("stale");
  });

  it("backs off after one failure — half an hour, not the full freshness window", () => {
    const soon = decideRefresh({ ...sys, lastSyncAttemptAt: minutesAgo(10), lastSyncStatus: "failed", consecutiveFailures: 1 });
    expect(soon).toMatchObject({ shouldRefresh: false, reason: "recent_failure_backoff" });
    expect(soon.retryAfterSeconds).toBeLessThanOrEqual(30 * 60);

    const later = decideRefresh({ ...sys, lastSyncAttemptAt: minutesAgo(31), lastSyncStatus: "failed", consecutiveFailures: 1 });
    expect(later.shouldRefresh).toBe(true);
  });

  it("doubles the backoff with each consecutive failure, capped at 12 hours", () => {
    // 3 failures → 30min × 2² = 2h backoff; only 1h has elapsed, so still waiting.
    const threeFails = decideRefresh({ ...sys, lastSyncAttemptAt: hoursAgo(1), lastSyncStatus: "failed", consecutiveFailures: 3 });
    expect(threeFails.shouldRefresh).toBe(false);

    // 2 failures → 1h backoff; 3h have elapsed, so it's eligible again.
    const pastItsBackoff = decideRefresh({ ...sys, lastSyncAttemptAt: hoursAgo(3), lastSyncStatus: "failed", consecutiveFailures: 2 });
    expect(pastItsBackoff.shouldRefresh).toBe(true);

    const manyFails = decideRefresh({ ...sys, lastSyncAttemptAt: hoursAgo(11), lastSyncStatus: "failed", consecutiveFailures: 20 }); // would be huge uncapped
    expect(manyFails.shouldRefresh).toBe(false);
    expect(manyFails.retryAfterSeconds).toBeLessThanOrEqual(3600); // ~1h left of the 12h cap
  });

  it("a skipped or partial last attempt doesn't trigger backoff", () => {
    const skipped = decideRefresh({ ...sys, lastSyncedAt: hoursAgo(30), lastSyncAttemptAt: minutesAgo(5), lastSyncStatus: "skipped", consecutiveFailures: 0 });
    expect(skipped).toEqual({ shouldRefresh: true, reason: "stale", retryAfterSeconds: null });

    const partial = decideRefresh({ ...sys, lastSyncedAt: hoursAgo(30), lastSyncAttemptAt: minutesAgo(5), lastSyncStatus: "partial", consecutiveFailures: 0 });
    expect(partial.shouldRefresh).toBe(true);
  });
});

describe("consecutiveFailures", () => {
  it("counts leading failures and stops at the first success", () => {
    expect(consecutiveFailures([{ status: "failed" }, { status: "failed" }, { status: "success" }, { status: "failed" }])).toBe(2);
  });

  it("is zero when the most recent attempt succeeded", () => {
    expect(consecutiveFailures([{ status: "success" }, { status: "failed" }])).toBe(0);
  });

  it("is zero for an empty history", () => {
    expect(consecutiveFailures([])).toBe(0);
  });

  it("skips over 'skipped' entries without breaking or counting the streak", () => {
    expect(consecutiveFailures([{ status: "failed" }, { status: "skipped" }, { status: "failed" }, { status: "success" }])).toBe(2);
  });

  it("stops at 'partial' the same as at 'success'", () => {
    expect(consecutiveFailures([{ status: "failed" }, { status: "partial" }, { status: "failed" }])).toBe(1);
  });
});
