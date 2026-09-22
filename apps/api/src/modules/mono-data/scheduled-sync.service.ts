import { Inject, Injectable, Logger } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { bankAccounts, type Db } from "@farmermarket/db";
import { DB } from "../../db/db.module";
import { MonoSyncService } from "./mono-sync.service";
import { consecutiveFailures, decideRefresh } from "./refresh-policy";

// The "system" half of the freshness policy: a scheduled sweep (an external
// cron, see mono-cron.controller.ts) that syncs whichever linked accounts are
// actually due, and leaves the rest alone. Every account gets the same
// question — {@link decideRefresh} — nothing here decides freshness itself.
//
// Deliberately no `skipped` log row for every account passed over: at cron
// scale that's every linked account, every run, almost all "still fresh" —
// logging each would swamp the sync-history table for no one to read. An
// admin's explicit click *is* logged when declined (see
// KycService.refreshBankDataForStaff) because there a person is waiting on
// an answer; a sweep is not.

export interface ScheduledSyncSummary {
  candidates: number;
  /** A sync was attempted — Mono was actually called. Its own success/failure is in that sync's log row, not here. */
  attempted: number;
  skippedFresh: number;
  skippedBackoff: number;
  /** The sync() call itself threw, rather than completing with a "failed" status — a defensive count, expected to stay at 0 in normal operation. */
  failed: number;
}

// Small enough that a sweep of many accounts doesn't open a burst of
// simultaneous Mono calls or DB transactions; large enough that a sweep of a
// few hundred accounts finishes in a reasonable time.
const CONCURRENCY = 5;

@Injectable()
export class ScheduledSyncService {
  private readonly log = new Logger("MonoScheduledSync");

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly monoSync: MonoSyncService,
  ) {}

  async runDueSyncs(now: Date = new Date()): Promise<ScheduledSyncSummary> {
    // Only accounts still authorised to talk to Mono. `disconnected` and
    // `reauth_required` need the customer, not a sweep — nothing sets those
    // today (see bank_accounts.status), but a sweep must not assume that
    // stays true.
    const accounts = await this.db
      .select({
        id: bankAccounts.id,
        userId: bankAccounts.userId,
        monoAccountId: bankAccounts.monoAccountId,
        lastSyncedAt: bankAccounts.lastSyncedAt,
        lastSyncAttemptAt: bankAccounts.lastSyncAttemptAt,
      })
      .from(bankAccounts)
      .where(eq(bankAccounts.status, "active"));

    const summary: ScheduledSyncSummary = { candidates: accounts.length, attempted: 0, skippedFresh: 0, skippedBackoff: 0, failed: 0 };

    for (let i = 0; i < accounts.length; i += CONCURRENCY) {
      const batch = accounts.slice(i, i + CONCURRENCY);
      await Promise.all(batch.map((a) => this.considerOne(a, now, summary)));
    }

    this.log.log(
      `swept ${summary.candidates} accounts: ${summary.attempted} attempted, ${summary.skippedFresh} fresh, ${summary.skippedBackoff} backing off, ${summary.failed} errored`,
    );
    return summary;
  }

  private async considerOne(
    account: { id: string; userId: string; monoAccountId: string; lastSyncedAt: Date | null; lastSyncAttemptAt: Date | null },
    now: Date,
    summary: ScheduledSyncSummary,
  ): Promise<void> {
    try {
      const recent = await this.monoSync.recentLogStatuses(account.id, 10);
      const decision = decideRefresh({
        trigger: "system",
        now,
        lastSyncedAt: account.lastSyncedAt,
        lastSyncAttemptAt: account.lastSyncAttemptAt,
        lastSyncStatus: (recent[0]?.status as "success" | "partial" | "failed" | "skipped" | undefined) ?? null,
        consecutiveFailures: consecutiveFailures(recent),
      });

      if (!decision.shouldRefresh) {
        if (decision.reason === "recent_failure_backoff") summary.skippedBackoff += 1;
        else summary.skippedFresh += 1;
        return;
      }

      await this.monoSync.sync({ userId: account.userId, monoAccountId: account.monoAccountId, trigger: "system", now });
      summary.attempted += 1;
    } catch (e) {
      // One account's failure — a network blip, a since-revoked account —
      // must not stop the rest of the sweep from running.
      summary.failed += 1;
      this.log.warn(`sweep failed for account ${account.id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}
