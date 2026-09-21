import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import {
  applicantProfiles,
  backfillMonoRecords,
  bankAccounts,
  bankTransactions,
  financialSummaries,
  identityVerifications,
  monoSyncLogs,
  users,
  type Db,
} from "@farmermarket/db";
import { createTestDb, type TestDb } from "../../test/test-db";

const ANALYSIS = {
  pulledAt: "2026-09-19T10:00:00.000Z",
  accountName: "ADA OKONKWO",
  institution: "GTBank",
  balanceKobo: 4_512_300,
  monthsAnalysed: 6,
  salaryDetected: true,
  estimatedMonthlyIncomeKobo: 25_000_000,
  incomeConfidence: "high",
  salaryRegularity: "regular",
  employerNameMatch: true,
  source: "income_api",
};
const CHECK = {
  checkedAt: "2026-09-20T09:00:00.000Z",
  source: "mashup",
  live: true,
  recordName: "ADA NGOZI OKONKWO",
  nameMatch: "exact",
  dateOfBirthMatch: true,
  genderMatch: true,
  phoneMatch: true,
  ninCorroborated: true,
  verdict: "match",
};

describe("backfillMonoRecords (real Postgres)", () => {
  let t: TestDb;
  let db: Db;
  let n = 0;

  const seed = async (over: Partial<typeof applicantProfiles.$inferInsert> = {}) => {
    n += 1;
    const phone = `23481${String(n).padStart(8, "0")}`;
    const [u] = await db.insert(users).values({ phone }).returning();
    await db.insert(applicantProfiles).values({ userId: u.id, fullName: "Ada", phone, ...over });
    return u.id;
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const count = async (table: any, userId: string, col: any): Promise<number> =>
    (await db.select({ c: sql<number>`count(*)::int` }).from(table).where(eq(col, userId)))[0].c;

  beforeAll(async () => {
    t = await createTestDb();
    db = t.db;
  }, 90_000);
  afterAll(async () => t.close());

  it("builds the account, first snapshot and identity check from what the profile already holds", async () => {
    const id = await seed({
      monoAccountId: "acc_old",
      bankName: "GTBank",
      accountLast4: "4321",
      bankLinkedAt: new Date("2026-09-17T08:00:00Z"),
      bankAnalysis: ANALYSIS,
      identityLookup: CHECK,
    });

    const r = await backfillMonoRecords(db);
    expect(r).toMatchObject({ bankAccounts: 1, summaries: 1, identityChecks: 1, conflicts: 0 });

    const [acct] = await db.select().from(bankAccounts).where(eq(bankAccounts.userId, id));
    expect(acct).toMatchObject({ monoAccountId: "acc_old", institution: "GTBank", accountNumberLast4: "4321", balanceKobo: 4_512_300n });
    expect(acct.lastSyncedAt!.toISOString()).toBe(ANALYSIS.pulledAt);
    expect(acct.linkedAt.toISOString()).toBe("2026-09-17T08:00:00.000Z");

    const [sum] = await db.select().from(financialSummaries).where(eq(financialSummaries.userId, id));
    expect(sum).toMatchObject({ version: 1, source: "income_api", estimatedMonthlyIncomeKobo: 25_000_000n, salaryDetected: true, syncLogId: null });
    expect(sum.retrievedAt.toISOString()).toBe(ANALYSIS.pulledAt); // dated by when the data was pulled, not by the backfill
    expect(sum.bankAccountId).toBe(acct.id);

    const [idv] = await db.select().from(identityVerifications).where(eq(identityVerifications.userId, id));
    expect(idv).toMatchObject({ kind: "mashup", method: "no_consent", verdict: "match", initiatedByStaffId: null });
    expect(idv.checkedAt.toISOString()).toBe(CHECK.checkedAt);
  });

  it("is idempotent — a second run changes nothing", async () => {
    const id = await seed({ monoAccountId: "acc_idem", bankAnalysis: ANALYSIS, identityLookup: CHECK });
    await backfillMonoRecords(db);
    const again = await backfillMonoRecords(db);
    expect(again).toMatchObject({ bankAccounts: 0, summaries: 0, identityChecks: 0 });
    expect(await count(financialSummaries, id, financialSummaries.userId)).toBe(1);
    expect(await count(identityVerifications, id, identityVerifications.userId)).toBe(1);
  });

  it("never overwrites a customer who already has records", async () => {
    const id = await seed({ monoAccountId: "acc_has", bankAnalysis: ANALYSIS });
    await db.insert(bankAccounts).values({ userId: id, monoAccountId: "acc_has", institution: "REAL BANK" });
    await db.insert(financialSummaries).values({
      userId: id, version: 1, retrievedAt: new Date(), analysisVersion: 1, source: "statement", analysis: {},
    });
    await backfillMonoRecords(db);
    const [acct] = await db.select().from(bankAccounts).where(eq(bankAccounts.userId, id));
    expect(acct.institution).toBe("REAL BANK");
    const sums = await db.select().from(financialSummaries).where(eq(financialSummaries.userId, id));
    expect(sums).toHaveLength(1);
    expect(sums[0].source).toBe("statement");
  });

  it("does not attach an account id that already belongs to another customer, and says so", async () => {
    const owner = await seed({ monoAccountId: "acc_dup" });
    await backfillMonoRecords(db); // the owner gets it first
    const other = await seed({ monoAccountId: "acc_dup" });
    const r = await backfillMonoRecords(db);
    expect(r.conflicts).toBe(1);
    expect(await count(bankAccounts, other, bankAccounts.userId)).toBe(0);
    expect(await count(bankAccounts, owner, bankAccounts.userId)).toBe(1);
  });

  it("leaves customers with nothing to backfill alone, and invents no transactions or logs", async () => {
    const id = await seed({}); // no bank, no identity check
    await backfillMonoRecords(db);
    expect(await count(bankAccounts, id, bankAccounts.userId)).toBe(0);
    expect(await count(financialSummaries, id, financialSummaries.userId)).toBe(0);
    expect(await count(bankTransactions, id, bankTransactions.userId)).toBe(0);
    expect(await count(monoSyncLogs, id, monoSyncLogs.userId)).toBe(0);
  });

  it("still works for a linked account that never produced an analysis", async () => {
    const id = await seed({ monoAccountId: "acc_bare" });
    const r = await backfillMonoRecords(db);
    expect(r.bankAccounts).toBeGreaterThanOrEqual(1);
    const [acct] = await db.select().from(bankAccounts).where(eq(bankAccounts.userId, id));
    expect(acct.lastSyncedAt).toBeNull(); // never synced, and it doesn't pretend to have been
    expect(await count(financialSummaries, id, financialSummaries.userId)).toBe(0);
  });
});
