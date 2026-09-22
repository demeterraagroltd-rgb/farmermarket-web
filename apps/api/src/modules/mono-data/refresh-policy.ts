import { FINANCIAL_DATA_FRESH_HOURS } from "../customers/customer-360";

// Whether a Mono pull is actually warranted right now, for the two ways one
// gets triggered without the customer or Mono asking for it: a staff click
// ("admin") and a scheduled sweep ("system"). `link` (the customer just
// connected) and `webhook` (Mono says something changed) always sync — they
// are the event, not a guess about whether one is due — so neither goes
// through this policy at all.
//
// Pure and DB-free on purpose: the caller assembles what's known about one
// account from wherever it's stored, this decides, nothing here touches a
// clock outside `now` or a database.

export type RefreshTrigger = "admin" | "system";

export type RefreshReason =
  | "never_synced"
  | "stale"
  | "fresh"
  | "too_soon_since_attempt"
  | "recent_failure_backoff";

export interface RefreshDecision {
  shouldRefresh: boolean;
  reason: RefreshReason;
  /** How long until this would decide differently. Null when shouldRefresh is true, or there's nothing to wait out. */
  retryAfterSeconds: number | null;
}

export interface RefreshPolicyInput {
  trigger: RefreshTrigger;
  now?: Date;
  /** Last time a sync actually produced usable data. */
  lastSyncedAt: Date | null;
  /** Last time a sync was *attempted*, success or not — the flood/backoff anchor. */
  lastSyncAttemptAt: Date | null;
  /** The most recent attempt's outcome, if any. */
  lastSyncStatus: "success" | "partial" | "failed" | "skipped" | null;
  /** How many attempts in a row (most recent first) ended "failed" — see {@link consecutiveFailures}. */
  consecutiveFailures: number;
  /** Overrides {@link FINANCIAL_DATA_FRESH_HOURS} — mainly for tests. */
  freshForHours?: number;
}

/** A human clicked "Refresh". Only a very recent attempt holds it back — otherwise it always runs, however fresh the data already is. */
const ADMIN_MIN_GAP_MS = 5 * 60 * 1000; // 5 minutes

/** A scheduled sweep backs off exponentially on repeated failures, so a broken account or a Mono outage isn't hammered. */
const BACKOFF_BASE_MS = 30 * 60 * 1000; // 30 minutes
const BACKOFF_MAX_MS = 12 * 60 * 60 * 1000; // 12 hours

const secondsUntil = (target: number, now: number): number => Math.max(1, Math.ceil((target - now) / 1000));

function freshnessReason(lastSyncedAt: Date | null, now: number, freshForHours: number): "never_synced" | "stale" | "fresh" {
  if (!lastSyncedAt) return "never_synced";
  const ageMs = now - lastSyncedAt.getTime();
  return ageMs > freshForHours * 3_600_000 ? "stale" : "fresh";
}

export function decideRefresh(input: RefreshPolicyInput): RefreshDecision {
  const now = (input.now ?? new Date()).getTime();
  const freshForHours = input.freshForHours ?? FINANCIAL_DATA_FRESH_HOURS;
  const staleness = freshnessReason(input.lastSyncedAt, now, freshForHours);

  if (input.trigger === "admin") {
    // A flood guard against a double-click, not a freshness gate — a human
    // asking again, once, is always honoured.
    if (input.lastSyncAttemptAt) {
      const readyAt = input.lastSyncAttemptAt.getTime() + ADMIN_MIN_GAP_MS;
      if (readyAt > now) {
        return { shouldRefresh: false, reason: "too_soon_since_attempt", retryAfterSeconds: secondsUntil(readyAt, now) };
      }
    }
    return { shouldRefresh: true, reason: staleness, retryAfterSeconds: null };
  }

  // trigger === "system"
  if (input.lastSyncStatus === "failed" && input.consecutiveFailures > 0 && input.lastSyncAttemptAt) {
    const backoffMs = Math.min(BACKOFF_BASE_MS * 2 ** (input.consecutiveFailures - 1), BACKOFF_MAX_MS);
    const readyAt = input.lastSyncAttemptAt.getTime() + backoffMs;
    if (readyAt > now) {
      return { shouldRefresh: false, reason: "recent_failure_backoff", retryAfterSeconds: secondsUntil(readyAt, now) };
    }
  }
  if (staleness === "fresh") {
    const readyAt = (input.lastSyncedAt as Date).getTime() + freshForHours * 3_600_000;
    return { shouldRefresh: false, reason: "fresh", retryAfterSeconds: secondsUntil(readyAt, now) };
  }
  return { shouldRefresh: true, reason: staleness, retryAfterSeconds: null };
}

/**
 * How many attempts in a row, most recent first, ended "failed" — a `skipped`
 * entry (we never even tried) neither breaks nor extends the streak, since it
 * says nothing about whether Mono itself is behaving. Stops at the first
 * `success` or `partial`.
 */
export function consecutiveFailures(recentLogs: Array<{ status: string }>): number {
  let n = 0;
  for (const log of recentLogs) {
    if (log.status === "failed") n += 1;
    else if (log.status === "skipped") continue;
    else break;
  }
  return n;
}
