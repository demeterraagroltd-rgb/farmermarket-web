import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { bankAccounts, monoSyncLogs, users, type Db } from "@farmermarket/db";
import { createTestDb, type TestDb } from "../../test/test-db";
import { MonoSyncService } from "./mono-sync.service";
import { ScheduledSyncService } from "./scheduled-sync.service";
import { FakeMonoClient } from "../integrations/mono/fake-mono.client";

// Real SQL: the risky part of a sweep is the query that picks candidates and
// the policy routing per account, not any one sync itself (already covered by
// mono-sync.integration.test.ts).
//
// A fresh database per test, not a shared one: unlike every other service in
// this module, a sweep has no customer id to scope it by — it reads *every*
// active account — so the only way an assertion on its summary counts means
// anything is if nothing another test seeded is still sitting in the table.

const HOUR = 3_600_000;
const MIN = 60_000;
const NOW = new Date();

describe("ScheduledSyncService (real Postgres)", () => {
  let t: TestDb;
  let db: Db;
  let scheduled: ScheduledSyncService;
  let n = 0;

  const seedAccount = async (over: Partial<typeof bankAccounts.$inferInsert> = {}) => {
    n += 1;
    const [u] = await db.insert(users).values({ phone: `23482${String(n).padStart(8, "0")}`, fullName: "Sweep Test" }).returning();
    const [a] = await db
      .insert(bankAccounts)
      .values({ userId: u.id, monoAccountId: `acc_sweep_${n}`, ...over })
      .returning();
    return { userId: u.id, account: a };
  };

  beforeEach(async () => {
    t = await createTestDb();
    db = t.db;
    scheduled = new ScheduledSyncService(db, new MonoSyncService(db, new FakeMonoClient()));
  }, 30_000);
  afterEach(async () => t.close());

  it("syncs a never-synced account and one that's gone stale, leaves a fresh one and a backing-off one alone, and ignores a disconnected account entirely", async () => {
    const never = await seedAccount({ lastSyncedAt: null, lastSyncAttemptAt: null });
    const fresh = await seedAccount({ lastSyncedAt: NOW, lastSyncAttemptAt: NOW });
    const stale = await seedAccount({ lastSyncedAt: new Date(NOW.getTime() - 30 * HOUR), lastSyncAttemptAt: new Date(NOW.getTime() - 30 * HOUR) });
    const backingOff = await seedAccount({ lastSyncedAt: null, lastSyncAttemptAt: new Date(NOW.getTime() - 5 * MIN) });
    await db.insert(monoSyncLogs).values({
      userId: backingOff.userId,
      bankAccountId: backingOff.account.id,
      monoAccountId: backingOff.account.monoAccountId,
      trigger: "system",
      status: "failed",
      startedAt: new Date(NOW.getTime() - 5 * MIN),
      errorMessage: "Mono is down",
    });
    const disconnected = await seedAccount({ lastSyncedAt: null, lastSyncAttemptAt: null, status: "disconnected" });

    const summary = await scheduled.runDueSyncs(NOW);

    expect(summary).toEqual({ candidates: 4, attempted: 2, skippedFresh: 1, skippedBackoff: 1, failed: 0 });

    const after = async (id: string) => (await db.select().from(bankAccounts).where(eq(bankAccounts.id, id)))[0];

    // Attempted: their bank_accounts row moved, and each got a real "system" sync log.
    for (const { account } of [never, stale]) {
      const row = await after(account.id);
      expect(row.lastSyncedAt).not.toBeNull();
      expect(row.lastSyncedAt!.getTime()).toBeGreaterThan(NOW.getTime() - MIN);
      const logs = await db.select().from(monoSyncLogs).where(eq(monoSyncLogs.bankAccountId, account.id));
      expect(logs.some((l) => l.trigger === "system" && l.status === "success")).toBe(true);
    }

    // Left alone: unchanged, and — unlike an admin's declined click — no log row at all for the skip itself.
    const freshRow = await after(fresh.account.id);
    expect(freshRow.lastSyncedAt!.getTime()).toBe(NOW.getTime());
    expect((await db.select().from(monoSyncLogs).where(eq(monoSyncLogs.bankAccountId, fresh.account.id))).length).toBe(0);

    const backingOffRow = await after(backingOff.account.id);
    expect(backingOffRow.lastSyncedAt).toBeNull();
    // Only the one failure log we seeded — the sweep didn't add another attempt.
    expect((await db.select().from(monoSyncLogs).where(eq(monoSyncLogs.bankAccountId, backingOff.account.id))).length).toBe(1);

    // Never touched: not even read as a candidate.
    const disconnectedRow = await after(disconnected.account.id);
    expect(disconnectedRow.lastSyncedAt).toBeNull();
    expect((await db.select().from(monoSyncLogs).where(eq(monoSyncLogs.bankAccountId, disconnected.account.id))).length).toBe(0);
  });

  it("syncs a failing account again once its backoff has elapsed", async () => {
    const { account } = await seedAccount({ lastSyncedAt: null, lastSyncAttemptAt: new Date(NOW.getTime() - 35 * MIN) });
    await db.insert(monoSyncLogs).values({
      userId: account.userId,
      bankAccountId: account.id,
      monoAccountId: account.monoAccountId,
      trigger: "system",
      status: "failed",
      startedAt: new Date(NOW.getTime() - 35 * MIN), // past the 30-minute, one-failure backoff
      errorMessage: "Mono is down",
    });

    const summary = await scheduled.runDueSyncs(NOW);
    expect(summary).toEqual({ candidates: 1, attempted: 1, skippedFresh: 0, skippedBackoff: 0, failed: 0 });
  });

  it("does nothing to an account that's still fresh, and returns a clean zero summary otherwise", async () => {
    const { account } = await seedAccount({ lastSyncedAt: NOW, lastSyncAttemptAt: NOW });
    const summary = await scheduled.runDueSyncs(NOW);
    expect(summary).toEqual({ candidates: 1, attempted: 0, skippedFresh: 1, skippedBackoff: 0, failed: 0 });
    const row = (await db.select().from(bankAccounts).where(eq(bankAccounts.id, account.id)))[0];
    expect(row.lastSyncedAt!.getTime()).toBe(NOW.getTime());
  });

  it("returns an all-zero summary when there are no accounts at all", async () => {
    expect(await scheduled.runDueSyncs(NOW)).toEqual({ candidates: 0, attempted: 0, skippedFresh: 0, skippedBackoff: 0, failed: 0 });
  });
});
