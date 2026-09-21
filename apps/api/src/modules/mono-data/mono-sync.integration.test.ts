import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, desc, eq, sql } from "drizzle-orm";
import {
  applicantProfiles,
  bankAccounts,
  bankTransactions,
  financialSummaries,
  identityVerifications,
  incomeProfiles,
  monoRawResponses,
  monoSyncLogs,
  staff,
  users,
  type Db,
} from "@farmermarket/db";
import { createTestDb, type TestDb } from "../../test/test-db";
import { KycService } from "../kyc/kyc.service";
import { CustomersService } from "../customers/customers.service";
import { MonoSyncService } from "./mono-sync.service";
import { openRaw } from "./raw-response";
import { latestIdentityChecks } from "./identity-verifications";
import { FakeMonoClient } from "../integrations/mono/fake-mono.client";
import { FakeLookupClient } from "../integrations/mono-lookup/fake-lookup.client";
import { encryptSecret } from "../../common/crypto/reversible-secret";
import type { MonoClient, MonoTransaction } from "../integrations/mono/mono.types";

const any = {} as never;
const DAY = 86_400_000;
const RAW_KEY = Buffer.alloc(32, 5).toString("base64");
const BVN_KEY = Buffer.alloc(32, 6).toString("base64");

// Mono answering with nothing usable (an outage, a disconnected account).
const emptyMono: MonoClient = {
  live: true,
  exchangeToken: async () => ({ accountId: "acc_x" }),
  getAccountDetails: async () => {
    throw new Error("Mono is down");
  },
  getTransactions: async () => [],
  getIncome: async () => null,
};

describe("Mono persistence (real Postgres)", () => {
  let t: TestDb;
  let db: Db;
  let staffId: string;
  let n = 0;

  const saved = { raw: process.env.MONO_RAW_ENCRYPTION_KEY, bvn: process.env.BVN_ENCRYPTION_KEY };

  const seed = async (over: Partial<typeof applicantProfiles.$inferInsert> = {}) => {
    n += 1;
    const phone = `23480${String(n).padStart(8, "0")}`;
    const [u] = await db.insert(users).values({ phone, fullName: "Ada Okonkwo" }).returning();
    await db.insert(applicantProfiles).values({
      userId: u.id,
      fullName: "Ada Okonkwo",
      phone,
      employer: "Acme Corp Ltd",
      bankLinkedAt: new Date(),
      ...over,
    });
    return u.id;
  };
  const syncSvc = (mono: MonoClient = new FakeMonoClient()) => new MonoSyncService(db, mono);
  const count = async (table: Parameters<Db["select"]>[0] extends never ? never : any, where?: unknown) =>
    (await db.select({ c: sql<number>`count(*)::int` }).from(table).where(where as never))[0].c;

  beforeAll(async () => {
    t = await createTestDb();
    db = t.db;
    [{ id: staffId }] = await db
      .insert(staff)
      .values({ email: "admin@example.com", passwordHash: "x", fullName: "Ada Admin", role: "admin" })
      .returning({ id: staff.id });
  }, 90_000);
  afterAll(async () => {
    for (const [k, v] of [
      ["MONO_RAW_ENCRYPTION_KEY", saved.raw],
      ["BVN_ENCRYPTION_KEY", saved.bvn],
    ] as const) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    await t.close();
  });
  beforeEach(() => {
    process.env.MONO_RAW_ENCRYPTION_KEY = RAW_KEY;
    process.env.BVN_ENCRYPTION_KEY = BVN_KEY;
  });

  // ── a first sync writes the whole picture ──────────────────────────────

  describe("first sync", () => {
    it("records the account, transactions, income, snapshot, raw responses and log together", async () => {
      const userId = await seed();
      const r = await syncSvc().sync({ userId, monoAccountId: "acc_first", trigger: "link" });

      expect(r.status).toBe("success");
      expect(r.preserved).toBe(false);
      expect(r.summaryVersion).toBe(1);

      const [acct] = await db.select().from(bankAccounts).where(eq(bankAccounts.userId, userId));
      expect(acct).toMatchObject({
        monoAccountId: "acc_first",
        institution: "GTBank",
        accountName: "ADA OKONKWO",
        accountNumberLast4: "4321",
        currency: "NGN",
        status: "active",
        balanceKobo: 4_512_300n,
      });
      expect(acct.lastSyncedAt).not.toBeNull();

      const txs = await db.select().from(bankTransactions).where(eq(bankTransactions.userId, userId));
      expect(txs).toHaveLength(12); // 6 months x (salary + spend)
      expect(txs.every((x) => x.monoAccountId === "acc_first" && x.externalIdSynthetic === false)).toBe(true);
      const credit = txs.find((x) => x.direction === "credit")!;
      expect(credit).toMatchObject({ amountKobo: 25_000_000n, narration: "SALARY - ACME CORP LTD" });
      // the original transaction is kept verbatim for the admin's "raw data" view
      expect((credit.raw as { narration: string }).narration).toBe("SALARY - ACME CORP LTD");

      const [inc] = await db.select().from(incomeProfiles).where(eq(incomeProfiles.userId, userId));
      expect(inc).toMatchObject({ monthlyIncomeKobo: 25_000_000n, confidence: "high", source: "mono_income" });

      const [sum] = await db.select().from(financialSummaries).where(eq(financialSummaries.userId, userId));
      expect(sum).toMatchObject({
        version: 1,
        source: "income_api",
        analysisVersion: 1,
        dataVersion: 1,
        salaryDetected: true,
        estimatedMonthlyIncomeKobo: 25_000_000n,
        balanceKobo: 4_512_300n,
      });
      expect(sum.syncLogId).toBe(r.syncLogId);

      const [log] = await db.select().from(monoSyncLogs).where(eq(monoSyncLogs.userId, userId));
      expect(log).toMatchObject({ id: r.syncLogId, trigger: "link", status: "success", transactionsFetched: 12, transactionsInserted: 12 });
      expect(log.endpoints).toMatchObject({ account_details: "ok", income: "ok", transactions: "ok", rawStored: true });

      // the legacy profile columns still mirror the newest snapshot
      const [p] = await db.select().from(applicantProfiles).where(eq(applicantProfiles.userId, userId));
      expect(p.bankAnalysis).toEqual(sum.analysis);
      expect(p.bankName).toBe("GTBank");
      expect(p.accountLast4).toBe("4321");
    });

    it("seals the raw responses: encrypted at rest, readable only with the key, expiring in 90 days", async () => {
      const userId = await seed();
      await syncSvc().sync({ userId, monoAccountId: "acc_raw", trigger: "link" });

      const raws = await db.select().from(monoRawResponses).where(eq(monoRawResponses.userId, userId));
      expect(raws.map((r) => r.endpoint).sort()).toEqual(["account_details", "income", "transactions"]);
      for (const r of raws) {
        expect(r.payloadEncrypted).not.toContain("SALARY");
        expect(r.payloadEncrypted).not.toContain("OKONKWO");
        const days = (r.expiresAt.getTime() - r.retrievedAt.getTime()) / DAY;
        expect(Math.round(days)).toBe(90);
      }
      const tx = raws.find((r) => r.endpoint === "transactions")!;
      const opened = openRaw(tx.payloadEncrypted) as { data: Array<{ narration: string }> };
      expect(opened.data.some((d) => d.narration === "SALARY - ACME CORP LTD")).toBe(true);
    });

    it("stores no raw responses at all — but everything else — when no key is configured", async () => {
      delete process.env.MONO_RAW_ENCRYPTION_KEY;
      const userId = await seed();
      const r = await syncSvc().sync({ userId, monoAccountId: "acc_nokey", trigger: "link" });
      expect(r.status).toBe("success");
      expect(await count(monoRawResponses, eq(monoRawResponses.userId, userId))).toBe(0);
      expect(await count(bankTransactions, eq(bankTransactions.userId, userId))).toBe(12);
      const [log] = await db.select().from(monoSyncLogs).where(eq(monoSyncLogs.userId, userId));
      expect((log.endpoints as { rawStored: boolean }).rawStored).toBe(false);
    });
  });

  // ── re-syncing ─────────────────────────────────────────────────────────

  describe("syncing again", () => {
    it("never duplicates a transaction, but adds a new snapshot and keeps the old one", async () => {
      const userId = await seed();
      const svc = syncSvc();
      await svc.sync({ userId, monoAccountId: "acc_again", trigger: "link" });
      const second = await svc.sync({ userId, monoAccountId: "acc_again", trigger: "admin", staffId });

      expect(second.transactionsFetched).toBe(12);
      expect(second.transactionsInserted).toBe(0); // all already stored
      expect(await count(bankTransactions, eq(bankTransactions.userId, userId))).toBe(12);

      const sums = await db.select().from(financialSummaries).where(eq(financialSummaries.userId, userId)).orderBy(financialSummaries.version);
      expect(sums.map((s) => s.version)).toEqual([1, 2]); // append-only
      expect(await count(incomeProfiles, eq(incomeProfiles.userId, userId))).toBe(2);
      expect(await count(bankAccounts, eq(bankAccounts.userId, userId))).toBe(1); // one account, not two

      const logs = await db.select().from(monoSyncLogs).where(eq(monoSyncLogs.userId, userId)).orderBy(monoSyncLogs.startedAt);
      expect(logs.map((l) => l.trigger)).toEqual(["link", "admin"]);
      expect(logs[1].triggeredByStaffId).toBe(staffId);
    });

    it("hands two simultaneous syncs different snapshot versions", async () => {
      const userId = await seed();
      const svc = syncSvc();
      await Promise.all([
        svc.sync({ userId, monoAccountId: "acc_race", trigger: "webhook" }),
        svc.sync({ userId, monoAccountId: "acc_race", trigger: "customer" }),
      ]);
      const versions = (await db.select().from(financialSummaries).where(eq(financialSummaries.userId, userId))).map((s) => s.version).sort();
      expect(versions).toEqual([1, 2]);
      expect(await count(bankTransactions, eq(bankTransactions.userId, userId))).toBe(12);
    });

    it("updates the stored balance from the latest pull", async () => {
      const userId = await seed();
      await syncSvc().sync({ userId, monoAccountId: "acc_bal", trigger: "link" });
      const richer: MonoClient = {
        ...new FakeMonoClient(),
        live: true,
        exchangeToken: async () => ({ accountId: "acc_bal" }),
        getAccountDetails: async () => ({
          accountId: "acc_bal", name: "ADA OKONKWO", accountNumberLast4: "4321", bvn: null,
          balanceKobo: 9_999_900, currency: "NGN", institution: "GTBank",
        }),
        getTransactions: async () => [],
        getIncome: async () => null,
      };
      await syncSvc(richer).sync({ userId, monoAccountId: "acc_bal", trigger: "admin", staffId });
      const [acct] = await db.select().from(bankAccounts).where(eq(bankAccounts.monoAccountId, "acc_bal"));
      expect(acct.balanceKobo).toBe(9_999_900n);
    });
  });

  // ── when Mono has nothing ──────────────────────────────────────────────

  describe("when Mono returns nothing usable", () => {
    it("keeps the last good snapshot and transactions, and logs the failure", async () => {
      const userId = await seed();
      await syncSvc().sync({ userId, monoAccountId: "acc_down", trigger: "link" });
      const [before] = await db.select().from(bankAccounts).where(eq(bankAccounts.monoAccountId, "acc_down"));

      const r = await syncSvc(emptyMono).sync({ userId, monoAccountId: "acc_down", trigger: "webhook" });
      expect(r.status).toBe("failed");
      expect(r.preserved).toBe(true);
      expect(r.summaryId).toBeNull();
      expect(r.analysis.source).toBe("income_api"); // the previous analysis, not "unavailable"

      expect(await count(financialSummaries, eq(financialSummaries.userId, userId))).toBe(1); // no empty snapshot
      expect(await count(bankTransactions, eq(bankTransactions.userId, userId))).toBe(12); // nothing deleted

      const [log] = await db.select().from(monoSyncLogs).where(and(eq(monoSyncLogs.userId, userId), eq(monoSyncLogs.status, "failed")));
      expect(log.errorMessage).toContain("Mono is down");
      expect(log.trigger).toBe("webhook");

      const [after] = await db.select().from(bankAccounts).where(eq(bankAccounts.monoAccountId, "acc_down"));
      expect(after.lastSyncedAt).toEqual(before.lastSyncedAt); // not marked as freshly synced
      expect(after.lastSyncAttemptAt!.getTime()).toBeGreaterThanOrEqual(before.lastSyncAttemptAt!.getTime()); // but the attempt is recorded
    });

    it("records one 'unavailable' snapshot the first time, and does not pile up more", async () => {
      const userId = await seed();
      const svc = syncSvc(emptyMono);
      await svc.sync({ userId, monoAccountId: "acc_never", trigger: "link" });
      await svc.sync({ userId, monoAccountId: "acc_never", trigger: "admin", staffId });
      await svc.sync({ userId, monoAccountId: "acc_never", trigger: "admin", staffId });

      const sums = await db.select().from(financialSummaries).where(eq(financialSummaries.userId, userId));
      expect(sums).toHaveLength(1);
      expect(sums[0].source).toBe("unavailable");
      expect(await count(monoSyncLogs, eq(monoSyncLogs.userId, userId))).toBe(3); // every attempt is still logged
    });

    it("stores what it did get when only one endpoint fails, and calls it partial", async () => {
      const userId = await seed();
      const base = new FakeMonoClient();
      const noIncomeThrows: MonoClient = {
        live: true,
        exchangeToken: base.exchangeToken.bind(base),
        getAccountDetails: base.getAccountDetails.bind(base),
        getTransactions: base.getTransactions.bind(base),
        getIncome: async () => {
          throw new Error("income product errored");
        },
      };
      const r = await syncSvc(noIncomeThrows).sync({ userId, monoAccountId: "acc_part", trigger: "link" });
      expect(r.status).toBe("partial");
      expect(await count(bankTransactions, eq(bankTransactions.userId, userId))).toBe(12);
      const [sum] = await db.select().from(financialSummaries).where(eq(financialSummaries.userId, userId));
      expect(sum.source).toBe("statement"); // fell back to analysing the transactions
      const [log] = await db.select().from(monoSyncLogs).where(eq(monoSyncLogs.userId, userId));
      expect(log.errorMessage).toContain("income");
      expect((log.endpoints as { income: string }).income).toBe("error");
    });
  });

  // ── transaction identity ───────────────────────────────────────────────

  describe("transactions without a provider id", () => {
    // A bank's dates are fixed facts — pin one, or every call would mint "new" transactions.
    const FIXED_DATE = new Date(Date.now() - 5 * DAY).toISOString();
    const noIds = (): MonoClient => {
      const base = new FakeMonoClient();
      const make = (): MonoTransaction[] => {
        const d = FIXED_DATE;
        const one: MonoTransaction = { id: null, category: null, amountKobo: 500_000, type: "debit", narration: "POS PURCHASE", date: d, balanceKobo: null };
        return [one, { ...one }, { ...one, narration: "ATM WITHDRAWAL" }]; // two identical + one different
      };
      return { ...base, live: true, exchangeToken: async () => ({ accountId: "acc_ids" }), getAccountDetails: base.getAccountDetails.bind(base), getIncome: async () => null, getTransactions: async () => make() };
    };

    it("keeps both of two genuinely identical transactions", async () => {
      const userId = await seed();
      await syncSvc(noIds()).sync({ userId, monoAccountId: "acc_ids_1", trigger: "link" });
      const rows = await db.select().from(bankTransactions).where(eq(bankTransactions.userId, userId));
      expect(rows).toHaveLength(3);
      expect(rows.every((r) => r.externalIdSynthetic)).toBe(true);
    });

    it("does not duplicate them on the next sync", async () => {
      const userId = await seed();
      const svc = syncSvc(noIds());
      await svc.sync({ userId, monoAccountId: "acc_ids_2", trigger: "link" });
      const again = await svc.sync({ userId, monoAccountId: "acc_ids_2", trigger: "customer" });
      expect(again.transactionsInserted).toBe(0);
      expect(await count(bankTransactions, eq(bankTransactions.userId, userId))).toBe(3);
    });
  });

  // ── retention ──────────────────────────────────────────────────────────

  describe("retention", () => {
    it("drops transactions older than 12 months and expired raw responses, keeps the rest", async () => {
      const userId = await seed();
      await syncSvc().sync({ userId, monoAccountId: "acc_ret", trigger: "link" });
      const [acct] = await db.select().from(bankAccounts).where(eq(bankAccounts.monoAccountId, "acc_ret"));

      await db.insert(bankTransactions).values([
        { userId, bankAccountId: acct.id, monoAccountId: "acc_ret", externalId: "old", direction: "debit", amountKobo: 1n, narration: "TOO OLD", occurredAt: new Date(Date.now() - 400 * DAY), retrievedAt: new Date() },
        { userId, bankAccountId: acct.id, monoAccountId: "acc_ret", externalId: "recent-ish", direction: "debit", amountKobo: 1n, narration: "STILL KEPT", occurredAt: new Date(Date.now() - 300 * DAY), retrievedAt: new Date() },
      ]);
      await db.insert(monoRawResponses).values({
        userId, bankAccountId: acct.id, monoAccountId: "acc_ret", endpoint: "transactions",
        payloadEncrypted: "x:y:z", payloadBytes: 1, retrievedAt: new Date(Date.now() - 100 * DAY), expiresAt: new Date(Date.now() - 10 * DAY),
      });

      await syncSvc().sync({ userId, monoAccountId: "acc_ret", trigger: "admin", staffId });

      const narrations = (await db.select({ n: bankTransactions.narration }).from(bankTransactions).where(eq(bankTransactions.userId, userId))).map((r) => r.n);
      expect(narrations).not.toContain("TOO OLD");
      expect(narrations).toContain("STILL KEPT");
      const raws = await db.select({ payload: monoRawResponses.payloadEncrypted }).from(monoRawResponses).where(eq(monoRawResponses.userId, userId));
      expect(raws.some((r) => r.payload === "x:y:z")).toBe(false); // the expired one is gone
      expect(raws.length).toBeGreaterThanOrEqual(3); // this sync's own are there

      const [latest] = await db.select().from(monoSyncLogs).where(eq(monoSyncLogs.userId, userId)).orderBy(desc(monoSyncLogs.startedAt)).limit(1);
      expect((latest.endpoints as { retention: { transactionsPurged: number; rawPurged: number } }).retention).toEqual({ transactionsPurged: 1, rawPurged: 1 });
    });
  });

  // ── one account, one customer ──────────────────────────────────────────

  describe("account ownership", () => {
    it("refuses to attach one Mono account to two customers, and writes nothing for the second", async () => {
      const a = await seed();
      const b = await seed();
      await syncSvc().sync({ userId: a, monoAccountId: "acc_shared", trigger: "link" });
      await expect(syncSvc().sync({ userId: b, monoAccountId: "acc_shared", trigger: "link" })).rejects.toThrow(/already linked to a different customer/i);
      expect(await count(bankAccounts, eq(bankAccounts.userId, b))).toBe(0);
      expect(await count(bankTransactions, eq(bankTransactions.userId, b))).toBe(0);
      expect(await count(financialSummaries, eq(financialSummaries.userId, b))).toBe(0);
    });

    it("linkBank rejects the second customer before touching their profile", async () => {
      const mono = new FakeMonoClient(); // always exchanges to acct_fake
      const kyc = new KycService(db, any, any, any, mono, any, new MonoSyncService(db, mono));
      const a = await seed();
      const b = await seed();

      const ok = await kyc.linkBank(a, "code-a");
      expect(ok.linked).toBe(true);
      expect(ok.analysisReady).toBe(true);

      await expect(kyc.linkBank(b, "code-b")).rejects.toThrow(/already linked/i);
      const [pb] = await db.select().from(applicantProfiles).where(eq(applicantProfiles.userId, b));
      expect(pb.monoAccountId).toBeNull(); // not pointed at someone else's account
    });
  });

  // ── the webhook path ───────────────────────────────────────────────────

  describe("webhook", () => {
    it("re-syncs a known account, logged as a webhook, and ignores an unknown one", async () => {
      const mono = new FakeMonoClient();
      const kyc = new KycService(db, any, any, any, mono, any, new MonoSyncService(db, mono));
      const userId = await seed();
      await syncSvc().sync({ userId, monoAccountId: "acc_hook", trigger: "link" });

      await kyc.refreshBankAnalysisByAccount("acc_hook");
      const triggers = (await db.select({ t: monoSyncLogs.trigger }).from(monoSyncLogs).where(eq(monoSyncLogs.userId, userId)).orderBy(monoSyncLogs.startedAt)).map((r) => r.t);
      expect(triggers).toEqual(["link", "webhook"]);

      const before = await count(monoSyncLogs);
      await kyc.refreshBankAnalysisByAccount("acc_nobody");
      expect(await count(monoSyncLogs)).toBe(before); // nothing happened
    });

    it("also finds an account linked before the bank_accounts table existed", async () => {
      const mono = new FakeMonoClient();
      const kyc = new KycService(db, any, any, any, mono, any, new MonoSyncService(db, mono));
      const userId = await seed({ monoAccountId: "acc_legacy" }); // profile column only
      await kyc.refreshBankAnalysisByAccount("acc_legacy");
      expect(await count(bankAccounts, eq(bankAccounts.userId, userId))).toBe(1);
    });
  });

  // ── identity history ───────────────────────────────────────────────────

  describe("identity verification history", () => {
    it("keeps every check — a NIN check no longer erases the Mashup one — and records who ran it", async () => {
      const lookup = new FakeLookupClient();
      const kyc = new KycService(db, any, any, any, new FakeMonoClient(), lookup, new MonoSyncService(db, new FakeMonoClient()));
      const userId = await seed({
        dateOfBirth: "1992-04-28",
        nin: "22222222222",
        bvnHash: "h",
        bvnLast4: "2222",
        bvnEncrypted: encryptSecret("22222222222"),
      });

      await kyc.verifyBvnNinMashup(staffId, userId);
      await kyc.lookupNin(staffId, userId);

      const rows = await db.select().from(identityVerifications).where(eq(identityVerifications.userId, userId)).orderBy(identityVerifications.checkedAt);
      expect(rows.map((r) => r.kind)).toEqual(["mashup", "nin"]);
      expect(rows.every((r) => r.initiatedByStaffId === staffId)).toBe(true);
      expect(rows.map((r) => r.method)).toEqual(["no_consent", "no_consent"]);
      expect(rows[0]).toMatchObject({ live: false, recordName: "ADA NGOZI OKONKWO" }); // fake client: recorded, flagged not-live

      const latest = await latestIdentityChecks(db, userId);
      expect(Object.keys(latest).sort()).toEqual(["mashup", "nin"]);

      // and the legacy profile column still holds the newest one
      const [p] = await db.select().from(applicantProfiles).where(eq(applicantProfiles.userId, userId));
      expect((p.identityLookup as { source: string }).source).toBe("nin");
    });

    it("never stores the government record itself", async () => {
      const lookup = new FakeLookupClient();
      const kyc = new KycService(db, any, any, any, new FakeMonoClient(), lookup, new MonoSyncService(db, new FakeMonoClient()));
      const userId = await seed({ dateOfBirth: "1992-04-28", nin: "22222222222" });
      await kyc.lookupNin(staffId, userId);
      const [row] = await db.select().from(identityVerifications).where(eq(identityVerifications.userId, userId));
      const blob = JSON.stringify(row);
      expect(blob).not.toContain("22222222222"); // no full identifier
      expect(blob).not.toContain("08031234512"); // the record's phone number
      expect(Object.keys(row.result as object)).not.toContain("photo");
    });
  });

  // ── erasure ────────────────────────────────────────────────────────────

  describe("purging a customer", () => {
    it("removes their Mono data too, instead of failing on a foreign key", async () => {
      const userId = await seed();
      await syncSvc().sync({ userId, monoAccountId: "acc_purge", trigger: "link" });
      const kyc = new KycService(db, any, any, any, new FakeMonoClient(), new FakeLookupClient(), new MonoSyncService(db, new FakeMonoClient()));
      await db.update(applicantProfiles).set({ dateOfBirth: "1992-04-28", nin: "22222222222" }).where(eq(applicantProfiles.userId, userId));
      await kyc.lookupNin(staffId, userId);

      // no orders and no credit profile → the hard-purge path
      const out = await new CustomersService(db).remove(userId, staffId, "test erasure");
      expect(out.outcome).toBe("purged");

      const remaining = [
        await count(bankAccounts, eq(bankAccounts.userId, userId)),
        await count(bankTransactions, eq(bankTransactions.userId, userId)),
        await count(financialSummaries, eq(financialSummaries.userId, userId)),
        await count(incomeProfiles, eq(incomeProfiles.userId, userId)),
        await count(monoRawResponses, eq(monoRawResponses.userId, userId)),
        await count(monoSyncLogs, eq(monoSyncLogs.userId, userId)),
        await count(identityVerifications, eq(identityVerifications.userId, userId)),
      ];
      expect(remaining).toEqual([0, 0, 0, 0, 0, 0, 0]);
      expect(await count(users, eq(users.id, userId))).toBe(0);
    });
  });
});
