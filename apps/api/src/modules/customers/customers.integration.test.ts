import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import {
  applicantProfiles,
  applicationDecisions,
  applications,
  auditLogs,
  bankAccounts,
  bankTransactions,
  bnplPlans,
  creditProfiles,
  orderItems,
  orders,
  repaymentSchedules,
  repayments,
  sessions,
  staff,
  users,
  type Db,
} from "@farmermarket/db";
import { createTestDb, type TestDb } from "../../test/test-db";
import { KycService } from "../kyc/kyc.service";
import { MonoSyncService } from "../mono-data/mono-sync.service";
import { WalletService } from "../wallet/wallet.service";
import { OrdersService } from "../orders/orders.service";
import { CustomersService } from "./customers.service";
import { Customer360Service } from "./customer-360.service";

// Real SQL, real migrations (see test/test-db.ts) — these tests exist because
// the risky parts of the Customer 360 are joins, jsonb and audit writes, which
// a mocked drizzle would happily pass while the query is wrong.

const DAY = 86_400_000;
const any = {} as never; // collaborators these code paths never touch

describe("Customer 360 (real Postgres)", () => {
  let t: TestDb;
  let db: Db;
  let customers: CustomersService;
  let c360: Customer360Service;
  let staffId: string;
  let planId: string;

  // Fully-populated customer: verified, bank linked, ordered, repaying.
  let fullId: string;
  // Bare customer: an account and nothing else (no KYC profile at all).
  let bareId: string;

  beforeAll(async () => {
    t = await createTestDb();
    db = t.db;
    const kyc = new KycService(db, any, any, any, any, any, new MonoSyncService(db, any));
    const wallet = new WalletService(db, any, any, any);
    const ordersSvc = new OrdersService(db, any, any, kyc, any);
    customers = new CustomersService(db);
    c360 = new Customer360Service(db, kyc, wallet, ordersSvc);

    [{ id: staffId }] = await db
      .insert(staff)
      .values({ email: "admin@example.com", passwordHash: "x", fullName: "Ada Admin", role: "admin" })
      .returning({ id: staff.id });
    [{ id: planId }] = await db
      .insert(bnplPlans)
      .values({ name: "Pay Over 2 Months", durationMonths: 2 })
      .returning({ id: bnplPlans.id });

    // ── the full customer ────────────────────────────────────────────────
    const [u] = await db
      .insert(users)
      .values({ phone: "2348011111111", fullName: "Ada Okonkwo", email: "ada@example.com" })
      .returning();
    fullId = u.id;
    await db.insert(applicantProfiles).values({
      userId: fullId,
      fullName: "Ada Okonkwo",
      phone: "2348011111111",
      email: "ada@example.com",
      dateOfBirth: "1992-04-28",
      gender: "female",
      bvnHash: "hash",
      bvnLast4: "8901",
      nin: "22222222222",
      residentialAddress: { street: "1 Marina", city: "Lagos", state: "Lagos", lga: "Lagos Island" },
      employmentType: "Private",
      employer: "Acme Corp",
      jobTitle: "Analyst",
      netMonthlySalaryKobo: 25_000_000n,
      verificationStatus: "verified",
      monoAccountId: "acc_123",
      bankName: "GTBank",
      accountLast4: "4321",
      bankLinkedAt: new Date(Date.now() - 2 * DAY),
      bankAnalysis: {
        pulledAt: new Date(Date.now() - 2 * 3_600_000).toISOString(),
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
      },
      identityLookup: {
        checkedAt: "2026-09-21T10:00:00.000Z",
        source: "mashup",
        live: true,
        recordName: "ADA NGOZI OKONKWO",
        nameMatch: "exact",
        dateOfBirthMatch: true,
        genderMatch: true,
        phoneMatch: true,
        ninCorroborated: true,
        verdict: "match",
      },
    });
    await db.insert(creditProfiles).values({
      userId: fullId,
      creditLimitKobo: 50_000_000n,
      usedCreditKobo: 10_000_000n,
      tier: "Gold",
      isVerified: true,
    });

    const [o] = await db
      .insert(orders)
      .values({
        userId: fullId,
        status: "confirmed",
        subtotalKobo: 10_000_000n,
        totalKobo: 10_000_000n,
        bnplPlanId: planId,
        pickupCenterName: "Ikeja Hub",
        pickupCenterAddress: "12 Allen Ave",
      })
      .returning();
    await db.insert(orderItems).values({
      orderId: o.id,
      name: "Big Bull Rice 50kg",
      imageUrl: "x",
      quantity: 2,
      unitPriceKobo: 5_000_000n,
    });
    const [s1, s2] = await db
      .insert(repaymentSchedules)
      .values([
        {
          orderId: o.id,
          userId: fullId,
          installmentNumber: 1,
          totalInstallments: 2,
          amountKobo: 5_000_000n,
          amountPaidKobo: 5_000_000n,
          dueDate: new Date(Date.now() - 10 * DAY),
          isPaid: true,
        },
        {
          orderId: o.id,
          userId: fullId,
          installmentNumber: 2,
          totalInstallments: 2,
          amountKobo: 5_000_000n,
          dueDate: new Date(Date.now() + 20 * DAY),
        },
      ])
      .returning();
    await db.insert(repayments).values({ repaymentScheduleId: s1.id, amountKobo: 5_000_000n });
    void s2;

    const [a] = await db
      .insert(applications)
      .values({
        reference: "FM-2026-00001",
        userId: fullId,
        status: "limit_active",
        channel: "web",
        fullName: "Ada Okonkwo",
        phone: "2348011111111",
        requestedLimitKobo: 50_000_000n,
      })
      .returning();
    await db.insert(applicationDecisions).values({
      applicationId: a.id,
      outcome: "approved",
      approvedLimitKobo: 50_000_000n,
      tier: "Gold",
      decidedBy: staffId,
    });

    // ── the bare customer ────────────────────────────────────────────────
    [{ id: bareId }] = await db.insert(users).values({ phone: "2348022222222" }).returning({ id: users.id });
  }, 90_000);

  afterAll(async () => {
    await t.close();
  });

  // ── list ───────────────────────────────────────────────────────────────

  describe("findAll", () => {
    it("derives every status the list shows, without shipping the raw JSON", async () => {
      const rows = await customers.findAll();
      const full = rows.find((r) => r.id === fullId)!;
      expect(full).toMatchObject({
        accountStatus: "active",
        kycStatus: "verified",
        bvnStatus: "verified", // a Mashup check covers the BVN
        ninStatus: "verified",
        bankState: "connected",
        employmentState: "complete",
        freshness: "fresh",
      });
      expect(full.lastFinancialSyncAt).toBeTruthy();
      expect(full).not.toHaveProperty("bankAnalysis");
      expect(full).not.toHaveProperty("identityLookup");
    });

    it("keeps the fields the existing page and command palette already read", async () => {
      const full = (await customers.findAll()).find((r) => r.id === fullId)!;
      expect(full.creditLimitKobo).toBe(50_000_000n);
      expect(full.tier).toBe("Gold");
      expect(full.isVerified).toBe(true);
    });

    it("lists a customer with no KYC profile instead of dropping them", async () => {
      const bare = (await customers.findAll()).find((r) => r.id === bareId)!;
      expect(bare.kycStatus).toBeNull();
      expect(bare.bvnStatus).toBe("not_provided");
      expect(bare.bankState).toBe("not_connected");
      expect(bare.employmentState).toBe("not_provided");
      expect(bare.freshness).toBe("never");
    });
  });

  // ── detail ─────────────────────────────────────────────────────────────

  describe("getDetail", () => {
    it("404s an unknown customer", async () => {
      await expect(c360.getDetail(staffId, "00000000-0000-4000-8000-000000000000")).rejects.toThrow(/not found/i);
    });

    it("assembles identity, bank, financial, orders, repayments and applications", async () => {
      const d = await c360.getDetail(staffId, fullId);

      expect(d.customer).toMatchObject({ fullName: "Ada Okonkwo", accountStatus: "active" });
      expect(d.summary).toMatchObject({
        kycStatus: "verified",
        bankState: "connected",
        estimatedMonthlyIncomeKobo: 25_000_000,
        incomeRegularity: "regular",
        bankBalanceKobo: 4_512_300,
      });
      expect(d.summary.freshness.state).toBe("fresh");

      expect(d.identity.bvn.state).toBe("verified");
      expect(d.identity.mashup.state).toBe("verified");
      expect(d.bank.accounts).toHaveLength(1);
      expect(d.bank.accounts[0]).toMatchObject({
        monoAccountId: "acc_123",
        bankName: "GTBank",
        accountMasked: "•••• 4321",
        status: "connected",
      });

      // declared 250k vs bank-shown 250k
      expect(d.financial.income.band).toBe("matches");
      expect(d.financial.employerMatch).toBe(true);

      expect(d.orders).toHaveLength(1);
      expect(d.orders[0]).toMatchObject({ pickupCenterName: "Ikeja Hub", repaymentStatus: "current" });
      expect(d.orders[0].items[0]).toMatchObject({ name: "Big Bull Rice 50kg", quantity: 2 });

      expect(d.repayments.summary).toMatchObject({ totalFinanced: 100000, totalRepaid: 50000, outstanding: 50000 });
      expect(d.repayments.history).toHaveLength(1);

      expect(d.applications).toHaveLength(1);
      expect(d.applications[0].decision).toMatchObject({ outcome: "approved", tier: "Gold", decidedBy: "Ada Admin" });
    });

    it("masks BVN and NIN, and never returns the raw identifiers", async () => {
      const d = await c360.getDetail(staffId, fullId);
      expect(d.identity.bvnMasked).toBe("•••••••8901");
      expect(d.identity.ninMasked).toBe("•••••••8901".replace("8901", "2222"));
      const blob = JSON.stringify(d, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
      expect(blob).not.toContain("22222222222"); // the full NIN
      expect(blob).not.toContain('"bvnHash"');
      expect(blob).not.toContain('"bvnEncrypted"');
    });

    it("keeps declared facts apart from verified identity", async () => {
      const d = await c360.getDetail(staffId, fullId);
      expect(d.declared).toMatchObject({ employer: "Acme Corp", declaredMonthlyIncomeKobo: 25_000_000 });
      // the government record's name lives under identity, not declared
      expect(d.identity.latestCheck?.recordName).toBe("ADA NGOZI OKONKWO");
      expect(d.declared).not.toHaveProperty("recordName");
    });

    it("reports how much transaction history is stored — a count and a range, never the rows", async () => {
      const [u] = await db.insert(users).values({ phone: "2348055550001", fullName: "Has Txns" }).returning();
      const [acct] = await db
        .insert(bankAccounts)
        .values({ userId: u.id, monoAccountId: "acc_txn_cov" })
        .returning({ id: bankAccounts.id });
      const base = { userId: u.id, bankAccountId: acct.id, monoAccountId: "acc_txn_cov", direction: "credit" as const, amountKobo: 100n, retrievedAt: new Date() };
      await db.insert(bankTransactions).values([
        { ...base, externalId: "t1", occurredAt: new Date("2026-03-05T10:00:00Z") },
        { ...base, externalId: "t2", occurredAt: new Date("2026-08-20T10:00:00Z") },
      ]);
      const d = await c360.getDetail(staffId, u.id);
      expect(d.bank.transactions).toEqual({
        count: 2,
        earliest: "2026-03-05T10:00:00.000Z",
        latest: "2026-08-20T10:00:00.000Z",
      });
      expect(JSON.stringify(d)).not.toContain("t1");
    });

    it("returns an empty-but-valid shape for a customer with no KYC profile", async () => {
      const d = await c360.getDetail(staffId, bareId);
      expect(d.declared).toBeNull();
      expect(d.summary.kycStatus).toBe("unverified");
      expect(d.summary.bankState).toBe("not_connected");
      expect(d.bank.accounts).toEqual([]);
      expect(d.bank.transactions).toEqual({ count: 0, earliest: null, latest: null });
      expect(d.orders).toEqual([]);
      expect(d.repayments.summary.collectionStatus).toBe("none");
      expect(d.identity.bvn.state).toBe("not_provided");
    });

    it("records that the customer was viewed, once, and not as a KYC view too", async () => {
      const before = await db
        .select()
        .from(auditLogs)
        .where(and(eq(auditLogs.targetId, fullId), eq(auditLogs.actorStaffId, staffId)));
      await c360.getDetail(staffId, fullId);
      const after = await db
        .select()
        .from(auditLogs)
        .where(and(eq(auditLogs.targetId, fullId), eq(auditLogs.actorStaffId, staffId)));
      const added = after.slice(before.length).map((r) => r.action);
      expect(added).toEqual(["customer.viewed"]);
    });

    it("shows earlier audit entries on the customer's own timeline", async () => {
      const d = await c360.getDetail(staffId, fullId);
      expect(d.audit.some((e) => e.action === "customer.viewed" && e.staff?.name === "Ada Admin")).toBe(true);
    });
  });

  // ── suspend / activate / delete ────────────────────────────────────────

  describe("suspend", () => {
    it("suspends without ever deleting, even a customer with no history", async () => {
      const [{ id }] = await db.insert(users).values({ phone: "2348033333333" }).returning({ id: users.id });
      const out = await customers.suspend(id, staffId, "test");
      expect(out.outcome).toBe("suspended");
      const [row] = await db.select().from(users).where(eq(users.id, id));
      expect(row.deactivatedAt).not.toBeNull(); // still there — remove() would have purged this one
      expect(row.deactivatedReason).toBe("test");
    });

    it("revokes live sessions and logs it as a suspension, not a deletion", async () => {
      const [{ id }] = await db.insert(users).values({ phone: "2348044444444" }).returning({ id: users.id });
      await db.insert(sessions).values({
        userId: id,
        refreshTokenHash: "h",
        expiresAt: new Date(Date.now() + DAY),
      });
      await customers.suspend(id, staffId);
      const [s] = await db.select().from(sessions).where(eq(sessions.userId, id));
      expect(s.revokedAt).not.toBeNull();
      const [log] = await db.select().from(auditLogs).where(eq(auditLogs.targetId, id));
      expect(log.action).toBe("customer.suspended");
    });

    it("refuses to suspend twice, and Activate reverses it", async () => {
      const [{ id }] = await db.insert(users).values({ phone: "2348055555555" }).returning({ id: users.id });
      await customers.suspend(id, staffId);
      await expect(customers.suspend(id, staffId)).rejects.toThrow(/already suspended/i);
      await customers.reactivate(id, staffId);
      const [row] = await db.select().from(users).where(eq(users.id, id));
      expect(row.deactivatedAt).toBeNull();
    });

    it("leaves Delete's existing behaviour alone: purges a history-free customer", async () => {
      const [{ id }] = await db.insert(users).values({ phone: "2348066666666" }).returning({ id: users.id });
      const out = await customers.remove(id, staffId);
      expect(out.outcome).toBe("purged");
      expect(await db.select().from(users).where(eq(users.id, id))).toHaveLength(0);
    });

    it("leaves Delete's existing behaviour alone: soft-deletes a customer who has ordered", async () => {
      const out = await customers.remove(fullId, staffId, "fraud check");
      expect(out.outcome).toBe("deactivated");
      const [row] = await db.select().from(users).where(eq(users.id, fullId));
      expect(row.deactivatedAt).not.toBeNull();
      const detail = await c360.getDetail(staffId, fullId);
      expect(detail.customer.accountStatus).toBe("suspended");
      await customers.reactivate(fullId, staffId);
    });
  });
});
