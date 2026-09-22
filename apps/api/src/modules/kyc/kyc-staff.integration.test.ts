import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { desc, eq } from "drizzle-orm";
import { applicantProfiles, auditLogs, monoSyncLogs, staff, users, type Db } from "@farmermarket/db";
import { createTestDb, type TestDb } from "../../test/test-db";
import { KycService } from "./kyc.service";
import { MonoSyncService } from "../mono-data/mono-sync.service";
import { staffProfileEditSchema } from "./dto/kyc.dto";
import { FakeMonoClient } from "../integrations/mono/fake-mono.client";
import type { MonoClient } from "../integrations/mono/mono.types";

const any = {} as never;
const HOUR = 3_600_000;

// A Mono that answers but has nothing: the "outage / unentitled / disconnected"
// case. Every call resolves empty rather than throwing, like the real client's
// `.catch(() => null)` paths in pullAndStoreBankAnalysis.
const emptyMono: MonoClient = {
  live: true,
  exchangeToken: async () => ({ accountId: "acc_x" }),
  getAccountDetails: async () => {
    throw new Error("Mono is down");
  },
  getTransactions: async () => [],
  getIncome: async () => null,
};

describe("KYC staff actions (real Postgres)", () => {
  let t: TestDb;
  let db: Db;
  let staffId: string;

  const seed = async (phone: string, profile: Partial<typeof applicantProfiles.$inferInsert> = {}) => {
    const [u] = await db.insert(users).values({ phone, fullName: "Seed" }).returning();
    await db.insert(applicantProfiles).values({ userId: u.id, fullName: "Seed", phone, ...profile });
    return u.id;
  };
  const service = (mono: MonoClient) => new KycService(db, any, any, any, mono, any, new MonoSyncService(db, mono));

  beforeAll(async () => {
    t = await createTestDb();
    db = t.db;
    [{ id: staffId }] = await db
      .insert(staff)
      .values({ email: "admin@example.com", passwordHash: "x", fullName: "Ada Admin", role: "admin" })
      .returning({ id: staff.id });
  }, 90_000);
  afterAll(async () => t.close());

  // ── edit declared facts ────────────────────────────────────────────────

  describe("updateProfileAsStaff", () => {
    it("changes declared employment and records old → new on the audit log", async () => {
      const id = await seed("2348100000001", {
        employer: "Old Co",
        jobTitle: "Clerk",
        netMonthlySalaryKobo: 10_000_000n,
      });
      await service(new FakeMonoClient()).updateProfileAsStaff(staffId, id, {
        employer: "New Co",
        netMonthlySalaryNaira: 150_000,
      });

      const [p] = await db.select().from(applicantProfiles).where(eq(applicantProfiles.userId, id));
      expect(p.employer).toBe("New Co");
      expect(p.netMonthlySalaryKobo).toBe(15_000_000n);
      expect(p.jobTitle).toBe("Clerk"); // untouched

      const [log] = await db.select().from(auditLogs).where(eq(auditLogs.targetId, id)).orderBy(desc(auditLogs.createdAt));
      expect(log.action).toBe("customer.profile_edited");
      expect(log.actorStaffId).toBe(staffId);
      expect(log.metadata).toMatchObject({
        fields: ["employer", "netMonthlySalaryNaira"],
        changes: {
          employer: { from: "Old Co", to: "New Co" },
          netMonthlySalaryNaira: { from: 100_000, to: 150_000 },
        },
      });
    });

    it("keeps address and next-of-kin values out of the audit trail", async () => {
      const id = await seed("2348100000002");
      await service(new FakeMonoClient()).updateProfileAsStaff(staffId, id, {
        nextOfKin: { name: "Secret Person", relationship: "Sister", phone: "0800" },
      });
      const [log] = await db.select().from(auditLogs).where(eq(auditLogs.targetId, id));
      expect(JSON.stringify(log.metadata)).not.toContain("Secret Person");
      expect((log.metadata as { fields: string[] }).fields).toEqual(["nextOfKin"]);
    });

    it("refuses an empty edit", async () => {
      const id = await seed("2348100000003");
      await expect(service(new FakeMonoClient()).updateProfileAsStaff(staffId, id, {})).rejects.toThrow(
        /nothing to change/i,
      );
    });
  });

  describe("staffProfileEditSchema", () => {
    it("rejects identity fields outright rather than silently dropping them", () => {
      for (const key of ["bvn", "nin", "dateOfBirth", "fullName", "phone", "email", "gender"]) {
        expect(staffProfileEditSchema.safeParse({ [key]: "x" }).success, key).toBe(false);
      }
    });
    it("accepts the declared application fields", () => {
      expect(
        staffProfileEditSchema.safeParse({ employer: "Acme", jobTitle: "Analyst", salaryDay: 28 }).success,
      ).toBe(true);
    });
    it("still refuses a blank employer", () => {
      expect(staffProfileEditSchema.safeParse({ employer: "   " }).success).toBe(false);
    });
  });

  // ── refresh bank data ──────────────────────────────────────────────────

  describe("refreshBankDataForStaff", () => {
    it("has nothing to refresh without a linked account", async () => {
      const id = await seed("2348200000001");
      await expect(service(new FakeMonoClient()).refreshBankDataForStaff(staffId, id)).rejects.toThrow(
        /hasn't linked a bank account/i,
      );
    });

    it("re-pulls a linked account, stores the result and audits it", async () => {
      const id = await seed("2348200000002", { monoAccountId: "acc_1", employer: "Acme Corp" });
      const out = await service(new FakeMonoClient()).refreshBankDataForStaff(staffId, id);
      expect(out.refreshed).toBe(true);
      expect(out.analysis.salaryDetected).toBe(true);

      const [p] = await db.select().from(applicantProfiles).where(eq(applicantProfiles.userId, id));
      expect((p.bankAnalysis as { source: string }).source).not.toBe("unavailable");
      expect(p.bankName).toBe("GTBank");

      const [log] = await db.select().from(auditLogs).where(eq(auditLogs.targetId, id));
      expect(log.action).toBe("customer.bank_data_refreshed");
    });

    it("throttles a second refresh moments later with a 429, and logs the decline as 'skipped'", async () => {
      const id = await seed("2348200000003", { monoAccountId: "acc_2" });
      const svc = service(new FakeMonoClient());
      await svc.refreshBankDataForStaff(staffId, id);
      await expect(svc.refreshBankDataForStaff(staffId, id)).rejects.toMatchObject({ status: 429 });

      const logs = await db
        .select()
        .from(monoSyncLogs)
        .where(eq(monoSyncLogs.monoAccountId, "acc_2"))
        .orderBy(desc(monoSyncLogs.startedAt));
      expect(logs[0]).toMatchObject({ status: "skipped", trigger: "admin", triggeredByStaffId: staffId });
      // ...without disturbing the real sync's own log row from moments before.
      expect(logs[1]).toMatchObject({ status: "success", trigger: "admin" });
    });

    it("still throttles a legacy account with only a bank_analysis snapshot and no bank_accounts row", async () => {
      const id = await seed("2348200000006", {
        monoAccountId: "acc_legacy",
        bankAnalysis: { pulledAt: new Date().toISOString(), source: "income_api" },
      });
      await expect(service(new FakeMonoClient()).refreshBankDataForStaff(staffId, id)).rejects.toMatchObject({ status: 429 });
    });

    it("keeps the last good analysis when Mono comes back empty", async () => {
      const good = {
        pulledAt: new Date(Date.now() - 2 * HOUR).toISOString(),
        accountName: "ADA",
        institution: "GTBank",
        balanceKobo: 1_000_000,
        monthsAnalysed: 6,
        salaryDetected: true,
        estimatedMonthlyIncomeKobo: 25_000_000,
        incomeConfidence: "high",
        salaryRegularity: "regular",
        employerNameMatch: true,
        source: "income_api",
      };
      const id = await seed("2348200000004", { monoAccountId: "acc_3", bankAnalysis: good });

      const out = await service(emptyMono).refreshBankDataForStaff(staffId, id);
      expect(out.refreshed).toBe(false);
      expect(out.keptPreviousData).toBe(true);

      const [p] = await db.select().from(applicantProfiles).where(eq(applicantProfiles.userId, id));
      expect(p.bankAnalysis).toEqual(good); // not overwritten with "unavailable"
    });

    it("does store an 'unavailable' result when there was nothing before it", async () => {
      const id = await seed("2348200000005", { monoAccountId: "acc_4" });
      const out = await service(emptyMono).refreshBankDataForStaff(staffId, id);
      expect(out.keptPreviousData).toBe(false);
      const [p] = await db.select().from(applicantProfiles).where(eq(applicantProfiles.userId, id));
      expect((p.bankAnalysis as { source: string }).source).toBe("unavailable");
    });
  });
});
