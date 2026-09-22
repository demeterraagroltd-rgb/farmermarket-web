import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  applicantProfiles,
  auditLogs,
  bankAccounts,
  bankTransactions,
  monoRawResponses,
  staff,
  users,
  type Db,
} from "@farmermarket/db";
import { NotFoundException, ConflictException } from "@nestjs/common";
import { ROLES_KEY } from "../../common/decorators/roles.decorator";
import { createTestDb, type TestDb } from "../../test/test-db";
import { sealRaw } from "../mono-data/raw-response";
import { CustomersController } from "./customers.controller";
import { CustomerFinancialService } from "./customer-financial.service";
import { transactionFilterSchema, transactionListSchema } from "./dto/financial.dto";

// Real SQL: the risky parts here are the filters (amounts are bigint kobo,
// dates have day-boundary rules, search uses LIKE) and — above all — that one
// customer's ids can never reach another customer's data.

const RAW_KEY = Buffer.alloc(32, 5).toString("base64");
const OTHER_KEY = Buffer.alloc(32, 9).toString("base64");
const list = (over: Record<string, unknown> = {}) => transactionListSchema.parse(over);

describe("Customer financial data (real Postgres)", () => {
  let t: TestDb;
  let db: Db;
  let svc: CustomerFinancialService;
  let staffId: string;
  let adaId: string;
  let bolaId: string;
  let adaAcct: string;
  let adaSecond: string;
  let bolaAcct: string;
  let bolaTxId: string;
  // A customer for tests that add rows, so they can't disturb the fixed counts above.
  let extraId: string;
  let extraAcct: string;
  let n = 0;
  const savedKey = process.env.MONO_RAW_ENCRYPTION_KEY;

  const makeCustomer = async (name: string) => {
    n += 1;
    const [u] = await db.insert(users).values({ phone: `23481${String(n).padStart(8, "0")}`, fullName: name }).returning();
    return u.id;
  };
  const makeAccount = async (userId: string, monoId: string, over: Partial<typeof bankAccounts.$inferInsert> = {}) => {
    const [a] = await db
      .insert(bankAccounts)
      .values({ userId, monoAccountId: monoId, institution: "GTBank", accountName: "ADA OKONKWO", accountNumberLast4: "4321", ...over })
      .returning();
    return a.id;
  };
  const tx = async (
    userId: string,
    bankAccountId: string,
    externalId: string,
    over: Partial<typeof bankTransactions.$inferInsert> = {},
  ) => {
    const [r] = await db
      .insert(bankTransactions)
      .values({
        userId,
        bankAccountId,
        monoAccountId: "m",
        externalId,
        direction: "credit",
        amountKobo: 100_000n,
        narration: "TRANSFER",
        occurredAt: new Date("2026-08-10T10:00:00Z"),
        retrievedAt: new Date("2026-09-01T00:00:00Z"),
        ...over,
      })
      .returning({ id: bankTransactions.id });
    return r.id;
  };

  beforeAll(async () => {
    process.env.MONO_RAW_ENCRYPTION_KEY = RAW_KEY;
    t = await createTestDb();
    db = t.db;
    svc = new CustomerFinancialService(db);
    [{ id: staffId }] = await db
      .insert(staff)
      .values({ email: "admin@example.com", passwordHash: "x", fullName: "Ada Admin", role: "admin" })
      .returning({ id: staff.id });

    adaId = await makeCustomer("Ada Okonkwo");
    bolaId = await makeCustomer("Bola Ade");
    adaAcct = await makeAccount(adaId, "mono_ada_1");
    adaSecond = await makeAccount(adaId, "mono_ada_2", { institution: "Access", accountNumberLast4: "9999" });
    bolaAcct = await makeAccount(bolaId, "mono_bola_1");
    extraId = await makeCustomer("Extra Tester");
    extraAcct = await makeAccount(extraId, "mono_extra_1");

    // Ada, first account.
    await tx(adaId, adaAcct, "a1", { narration: "ACME CORP SALARY AUG", amountKobo: 30_000_000n, occurredAt: new Date("2026-08-25T09:00:00Z"), balanceAfterKobo: 31_000_000n, providerCategory: "transfer" });
    await tx(adaId, adaAcct, "a2", { direction: "debit", narration: "POS CHICKEN REPUBLIC", amountKobo: 550_000n, occurredAt: new Date("2026-08-26T12:00:00Z"), balanceAfterKobo: 30_450_000n, providerCategory: "pos" });
    await tx(adaId, adaAcct, "a3", { direction: "debit", narration: "100% CASHBACK_REVERSAL", amountKobo: 20_000n, occurredAt: new Date("2026-08-31T23:30:00Z"), providerCategory: "transfer" });
    await tx(adaId, adaAcct, "a4", { narration: "ACME CORP SALARY JUL", amountKobo: 30_000_000n, occurredAt: new Date("2026-07-25T09:00:00Z"), providerCategory: "transfer" });
    // Ada, second account.
    await tx(adaId, adaSecond, "b1", { narration: "FREELANCE PAYMENT", amountKobo: 5_000_000n, occurredAt: new Date("2026-08-15T09:00:00Z"), providerCategory: "transfer" });
    // Bola — must never surface under Ada.
    bolaTxId = await tx(bolaId, bolaAcct, "z1", { narration: "BOLA SECRET SALARY", amountKobo: 99_000_000n });
  });

  afterAll(async () => {
    if (savedKey === undefined) delete process.env.MONO_RAW_ENCRYPTION_KEY;
    else process.env.MONO_RAW_ENCRYPTION_KEY = savedKey;
    await t.close();
  });

  // ── Isolation ────────────────────────────────────────────────────────────

  describe("customer scoping", () => {
    it("never returns another customer's transactions", async () => {
      const r = await svc.listTransactions(adaId, list());
      expect(r.total).toBe(5);
      expect(r.items.some((i) => i.narration.includes("BOLA"))).toBe(false);
    });

    it("404s on another customer's account id", async () => {
      await expect(svc.listTransactions(adaId, list({ accountId: bolaAcct }))).rejects.toBeInstanceOf(NotFoundException);
      await expect(svc.statement(adaId, { accountId: bolaAcct })).rejects.toBeInstanceOf(NotFoundException);
      await expect(svc.incomeSources(adaId, { accountId: bolaAcct, months: 6 })).rejects.toBeInstanceOf(NotFoundException);
      await expect(
        svc.exportTransactionsCsv(adaId, transactionFilterSchema.parse({ accountId: bolaAcct }), staffId),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it("404s on another customer's transaction id, for every role", async () => {
      await expect(svc.getTransaction(adaId, bolaTxId, staffId, "admin")).rejects.toBeInstanceOf(NotFoundException);
      await expect(svc.getTransaction(adaId, bolaTxId, staffId, "credit")).rejects.toBeInstanceOf(NotFoundException);
    });

    it("keeps the totals, coverage and channel list to the customer too", async () => {
      const r = await svc.listTransactions(adaId, list());
      expect(r.coverage.total).toBe(5);
      expect(r.summary.creditsKobo).toBe(30_000_000 + 30_000_000 + 5_000_000);
      expect(r.accounts.map((a) => a.accountMasked)).toEqual(["•••• 4321", "•••• 9999"]);
    });
  });

  // ── Filters ──────────────────────────────────────────────────────────────

  describe("listing and filtering", () => {
    it("paginates with a stable order and reports the true total", async () => {
      const p1 = await svc.listTransactions(adaId, list({ pageSize: 2, page: 1 }));
      const p2 = await svc.listTransactions(adaId, list({ pageSize: 2, page: 2 }));
      const p3 = await svc.listTransactions(adaId, list({ pageSize: 2, page: 3 }));
      expect([p1.total, p1.totalPages]).toEqual([5, 3]);
      const ids = [...p1.items, ...p2.items, ...p3.items].map((i) => i.id);
      expect(new Set(ids).size).toBe(5);
      const dates = [...p1.items, ...p2.items, ...p3.items].map((i) => i.occurredAt);
      expect(dates).toEqual([...dates].sort().reverse());
    });

    it("filters by direction", async () => {
      const r = await svc.listTransactions(adaId, list({ type: "debit" }));
      expect(r.items.every((i) => i.direction === "debit")).toBe(true);
      expect(r.total).toBe(2);
      expect(r.summary).toEqual({ creditsKobo: 0, debitsKobo: 570_000, netKobo: -570_000 });
    });

    it("filters by account", async () => {
      const r = await svc.listTransactions(adaId, list({ accountId: adaSecond }));
      expect(r.items.map((i) => i.narration)).toEqual(["FREELANCE PAYMENT"]);
    });

    it("treats a date-only 'to' as the whole of that day", async () => {
      // a3 happened at 23:30 on the 31st — it must be inside "to 2026-08-31".
      const r = await svc.listTransactions(adaId, list({ from: "2026-08-31", to: "2026-08-31" }));
      expect(r.items.map((i) => i.narration)).toEqual(["100% CASHBACK_REVERSAL"]);
    });

    it("filters by amount in naira against bigint kobo", async () => {
      const r = await svc.listTransactions(adaId, list({ minNaira: 10000, maxNaira: 100000 }));
      expect(r.items.map((i) => i.narration)).toEqual(["FREELANCE PAYMENT"]);
    });

    it("searches descriptions case-insensitively", async () => {
      const r = await svc.listTransactions(adaId, list({ q: "chicken" }));
      expect(r.items.map((i) => i.narration)).toEqual(["POS CHICKEN REPUBLIC"]);
    });

    it("treats % and _ in a search literally", async () => {
      expect((await svc.listTransactions(adaId, list({ q: "100%" }))).total).toBe(1);
      // An unescaped "_" would match any single character and hit "ACME CORP…" rows too.
      expect((await svc.listTransactions(adaId, list({ q: "CASHBACK_REVERSAL" }))).total).toBe(1);
      expect((await svc.listTransactions(adaId, list({ q: "CASHBACK-REVERSAL" }))).total).toBe(0);
      expect((await svc.listTransactions(adaId, list({ q: "%" }))).total).toBe(1);
    });

    it("filters by channel and lists the channels available", async () => {
      const r = await svc.listTransactions(adaId, list({ channel: "pos" }));
      expect(r.total).toBe(1);
      expect(r.channels.sort()).toEqual(["pos", "transfer"]);
    });

    it("sorts by amount", async () => {
      const r = await svc.listTransactions(adaId, list({ sort: "smallest" }));
      expect(r.items[0].amountKobo).toBe(20_000);
    });

    it("returns kobo as numbers and never includes the raw record in the list", async () => {
      const r = await svc.listTransactions(adaId, list({ pageSize: 1 }));
      expect(typeof r.items[0].amountKobo).toBe("number");
      expect(r.items[0]).not.toHaveProperty("raw");
    });
  });

  describe("query validation", () => {
    it("rejects impossible input with a message, not a database error", () => {
      expect(transactionListSchema.safeParse({ from: "not-a-date" }).success).toBe(false);
      expect(transactionListSchema.safeParse({ from: "2026-09-10", to: "2026-09-01" }).success).toBe(false);
      expect(transactionListSchema.safeParse({ minNaira: 10, maxNaira: 5 }).success).toBe(false);
      expect(transactionListSchema.safeParse({ pageSize: 5000 }).success).toBe(false);
      expect(transactionListSchema.safeParse({ type: "refund" }).success).toBe(false);
      expect(transactionListSchema.safeParse({ accountId: "nope" }).success).toBe(false);
    });

    it("applies defaults", () => {
      expect(list()).toMatchObject({ page: 1, pageSize: 25, sort: "newest" });
    });
  });

  // ── Single transaction & raw ─────────────────────────────────────────────

  describe("transaction detail", () => {
    it("gives admins the original record and audits the view", async () => {
      const id = await tx(extraId, extraAcct, "raw1", { raw: { _id: "raw1", narration: "X", extra: "kept" } });
      const r = await svc.getTransaction(extraId, id, staffId, "admin");
      expect(r.raw).toEqual({ _id: "raw1", narration: "X", extra: "kept" });
      const [log] = await db.select().from(auditLogs).where(eq(auditLogs.action, "customer.transaction_raw_viewed"));
      expect(log).toMatchObject({ targetId: extraId, actorStaffId: staffId });
      expect(log.metadata).toEqual({ transactionId: id });
    });

    it("withholds the original record from credit officers, and doesn't audit a view that showed none", async () => {
      const id = await tx(extraId, extraAcct, "raw2", { raw: { secret: "x" } });
      const before = (await db.select().from(auditLogs).where(eq(auditLogs.action, "customer.transaction_raw_viewed"))).length;
      const r = await svc.getTransaction(extraId, id, staffId, "credit");
      expect(r.raw).toBeUndefined();
      expect(r.narration).toBe("TRANSFER");
      const after = (await db.select().from(auditLogs).where(eq(auditLogs.action, "customer.transaction_raw_viewed"))).length;
      expect(after).toBe(before);
    });
  });

  // ── Export ───────────────────────────────────────────────────────────────

  describe("CSV export", () => {
    it("exports the filtered rows, neutralises formulas and audits without the rows", async () => {
      await tx(extraId, extraAcct, "evil", { narration: '=HYPERLINK("http://evil.example","x")', occurredAt: new Date("2026-06-01T00:00:00Z") });
      const out = await svc.exportTransactionsCsv(extraId, transactionFilterSchema.parse({ to: "2026-06-30", q: "hyperlink" }), staffId);
      expect(out).toMatchObject({ rows: 1, truncated: false });
      expect(out.csv.charCodeAt(0)).toBe(0xfeff);
      expect(out.csv).toContain(`"'=HYPERLINK(""http://evil.example"",""x"")"`);
      expect(out.csv).toContain("1000.00");

      const [log] = await db.select().from(auditLogs).where(eq(auditLogs.action, "customer.transactions_exported"));
      expect(log.metadata).toMatchObject({ rows: 1, truncated: false });
      expect(JSON.stringify(log.metadata)).not.toContain("evil.example");
      expect(JSON.stringify(log.metadata)).not.toContain("hyperlink");
    });

    it("exports only this customer's rows", async () => {
      const out = await svc.exportTransactionsCsv(adaId, transactionFilterSchema.parse({}), staffId);
      expect(out.csv).not.toContain("BOLA SECRET");
    });
  });

  // ── Statement & income ───────────────────────────────────────────────────

  describe("statement", () => {
    it("builds monthly periods for one account, defaulting to the first-linked", async () => {
      const s = await svc.statement(adaId, {});
      expect(s.accountId).toBe(adaAcct);
      const july = s.periods!.find((p) => p.month === "2026-07")!;
      const aug = s.periods!.find((p) => p.month === "2026-08")!;
      expect(july).toMatchObject({ count: 1, creditsKobo: 30_000_000 });
      expect(aug).toMatchObject({ count: 3, creditsKobo: 30_000_000, debitsKobo: 570_000 });
      // The second account's ₦50,000 freelance credit is not in this statement.
      expect(aug.creditsKobo).toBe(30_000_000);
    });

    it("returns an empty statement, not an error, for a customer with no accounts", async () => {
      const lone = await makeCustomer("No Bank");
      const s = await svc.statement(lone, {});
      expect(s).toMatchObject({ accountId: null, periods: [], totals: null });
    });

    it("returns an empty statement for an account with no transactions", async () => {
      const lone = await makeCustomer("Empty Acct");
      const acct = await makeAccount(lone, "mono_empty");
      const s = await svc.statement(lone, { accountId: acct });
      expect(s.periods).toEqual([]);
    });
  });

  describe("income sources", () => {
    it("groups credits by payer across accounts", async () => {
      const r = await svc.incomeSources(adaId, { months: 12 }, new Date("2026-09-15T00:00:00Z"));
      const acme = r.sources.find((s) => s.key === "ACME CORP SALARY")!;
      expect(acme).toMatchObject({ count: 2, months: 2 });
      expect(r.sources.some((s) => s.samples.some((x) => x.includes("BOLA")))).toBe(false);
      expect(r.creditsAnalysed).toBeGreaterThanOrEqual(3);
    });

    it("only considers credits inside the window", async () => {
      const r = await svc.incomeSources(adaId, { months: 1 }, new Date("2026-10-15T00:00:00Z"));
      expect(r.sources).toEqual([]);
    });
  });

  // ── Raw Mono responses ───────────────────────────────────────────────────

  describe("raw Mono responses", () => {
    const insertRaw = async (userId: string, payload: unknown, expiresAt: Date, endpoint = "transactions") => {
      const sealed = sealRaw(payload)!;
      const [r] = await db
        .insert(monoRawResponses)
        .values({ userId, monoAccountId: "m", endpoint, payloadEncrypted: sealed.encrypted, payloadBytes: sealed.bytes, expiresAt })
        .returning({ id: monoRawResponses.id });
      return r.id;
    };
    const NOW = new Date("2026-09-15T00:00:00Z");

    it("lists metadata only — never the payload", async () => {
      await insertRaw(adaId, { balance: 1 }, new Date("2026-12-01T00:00:00Z"));
      const r = await svc.listRawResponses(adaId, 30, NOW);
      expect(r.storageEnabled).toBe(true);
      expect(r.items.length).toBeGreaterThan(0);
      expect(JSON.stringify(r)).not.toContain("balance");
      expect(JSON.stringify(r)).not.toContain("payloadEncrypted");
    });

    it("decrypts, returns the payload, and audits the open", async () => {
      const id = await insertRaw(adaId, { data: { name: "ADA", n: [1, 2] } }, new Date("2026-12-01T00:00:00Z"), "account_details");
      const r = await svc.getRawResponse(adaId, id, staffId, NOW);
      expect(r.payload).toEqual({ data: { name: "ADA", n: [1, 2] } });
      const logs = await db.select().from(auditLogs).where(eq(auditLogs.action, "customer.mono_raw_viewed"));
      expect(logs.some((l) => (l.metadata as { rawId: string }).rawId === id)).toBe(true);
    });

    it("404s for another customer's response, an expired one and an unknown id — and audits none", async () => {
      const others = await insertRaw(bolaId, { x: 1 }, new Date("2026-12-01T00:00:00Z"));
      const expired = await insertRaw(adaId, { x: 1 }, new Date("2026-09-01T00:00:00Z"));
      const before = (await db.select().from(auditLogs).where(eq(auditLogs.action, "customer.mono_raw_viewed"))).length;
      await expect(svc.getRawResponse(adaId, others, staffId, NOW)).rejects.toBeInstanceOf(NotFoundException);
      await expect(svc.getRawResponse(adaId, expired, staffId, NOW)).rejects.toBeInstanceOf(NotFoundException);
      await expect(svc.getRawResponse(adaId, "00000000-0000-4000-8000-000000000000", staffId, NOW)).rejects.toBeInstanceOf(NotFoundException);
      // …and the expired one isn't listed either.
      const listed = await svc.listRawResponses(adaId, 100, NOW);
      expect(listed.items.some((i) => i.id === expired)).toBe(false);
      const after = (await db.select().from(auditLogs).where(eq(auditLogs.action, "customer.mono_raw_viewed"))).length;
      expect(after).toBe(before);
    });

    it("409s — rather than 500s or leaking ciphertext — when the key can't open it", async () => {
      const id = await insertRaw(adaId, { x: 1 }, new Date("2026-12-01T00:00:00Z"));
      process.env.MONO_RAW_ENCRYPTION_KEY = OTHER_KEY; // rotated
      try {
        await expect(svc.getRawResponse(adaId, id, staffId, NOW)).rejects.toBeInstanceOf(ConflictException);
      } finally {
        process.env.MONO_RAW_ENCRYPTION_KEY = RAW_KEY;
      }
    });
  });

  // ── Spending analysis (Phase 5) ──────────────────────────────────────────

  describe("spending analysis", () => {
    let spendId: string;
    let spendAcct: string;
    // After every seeded date below (including the 25th-of-the-month salary
    // credits) — a "now" earlier than the data it's meant to explain would
    // make the exclusion below a bug in the test, not the code.
    const NOW = new Date("2026-09-26T12:00:00Z");

    beforeAll(async () => {
      spendId = await makeCustomer("Spend Tester");
      spendAcct = await makeAccount(spendId, "mono_spend_1");

      for (const m of ["2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"]) {
        await tx(spendId, spendAcct, `sal_${m}`, { narration: "ACME CORP SALARY", amountKobo: 30_000_000n, occurredAt: new Date(`${m}-25T09:00:00Z`) });
      }
      for (const m of ["2026-07", "2026-08", "2026-09"]) {
        await tx(spendId, spendAcct, `dstv_${m}`, { direction: "debit", narration: "DSTV SUBSCRIPTION", amountKobo: 620_000n, occurredAt: new Date(`${m}-05T09:00:00Z`) });
      }
      await tx(spendId, spendAcct, "bet1", { direction: "debit", narration: "BET9JA DEPOSIT", amountKobo: 10_000n, occurredAt: new Date("2026-04-10T09:00:00Z") });
      await tx(spendId, spendAcct, "bet2", { direction: "debit", narration: "BET9JA DEPOSIT", amountKobo: 90_000n, occurredAt: new Date("2026-09-10T09:00:00Z") });
      await tx(spendId, spendAcct, "loan1", { direction: "debit", narration: "FAIRMONEY LOAN REPAYMENT", amountKobo: 300_000n, occurredAt: new Date("2026-08-15T09:00:00Z") });
      for (let i = 0; i < 6; i++) {
        await tx(spendId, spendAcct, `pos${i}`, { direction: "debit", narration: "POS SHOPRITE", amountKobo: 500_000n, occurredAt: new Date(`2026-0${i + 4}-12T09:00:00Z`) });
      }
      await tx(spendId, spendAcct, "big1", { direction: "debit", narration: "POS EXPENSIVE ITEM", amountKobo: 5_000_000n, occurredAt: new Date("2026-09-18T09:00:00Z") });
    });

    it("categorises stored transactions on the fly (no sync has ever set bank_transactions.category here) and totals per category", async () => {
      const r = await svc.spendingAnalysis(spendId, { months: 6 }, NOW);
      const salary = r.categoryBreakdown.find((c) => c.category === "salary")!;
      expect(salary).toMatchObject({ count: 6, creditsKobo: 180_000_000, debitsKobo: 0 });
      const bills = r.categoryBreakdown.find((c) => c.category === "bills_utilities")!;
      expect(bills).toMatchObject({ count: 3, debitsKobo: 1_860_000 });
    });

    it("builds a monthly cash flow across the whole window, including any quiet months", async () => {
      const r = await svc.spendingAnalysis(spendId, { months: 6 }, NOW);
      expect(r.cashFlow).toHaveLength(7); // March (no activity) through September
      expect(r.cashFlow.map((c) => c.month)[0]).toBe("2026-03");
      const sept = r.cashFlow.find((c) => c.month === "2026-09")!;
      expect(sept.creditsKobo).toBe(30_000_000);
    });

    it("reports the gambling signal and calls its trend increasing", async () => {
      const r = await svc.spendingAnalysis(spendId, { months: 6 }, NOW);
      expect(r.gambling).toMatchObject({ present: true, count: 2, totalKobo: 100_000, monthsActive: 2, trend: "increasing" });
    });

    it("keeps loan repayment and loan received as separate signals", async () => {
      const r = await svc.spendingAnalysis(spendId, { months: 6 }, NOW);
      expect(r.loanRepayment).toMatchObject({ present: true, count: 1, totalKobo: 300_000 });
      expect(r.loanReceived).toMatchObject({ present: false, count: 0, totalKobo: 0 });
    });

    it("flags the recurring DSTV subscription as a recurring expense, under its category", async () => {
      const r = await svc.spendingAnalysis(spendId, { months: 6 }, NOW);
      const dstv = r.recurringExpenses.items.find((i) => i.key.includes("DSTV"))!;
      expect(dstv).toMatchObject({ recurring: true, months: 3, category: "bills_utilities", totalKobo: 1_860_000 });
    });

    it("flags exactly the one transaction that's well above this account's usual size", async () => {
      const r = await svc.spendingAnalysis(spendId, { months: 6 }, NOW);
      expect(r.unusualTransactions.map((u) => u.narration)).toEqual(["POS EXPENSIVE ITEM"]);
    });

    it("404s on another customer's account id", async () => {
      await expect(svc.spendingAnalysis(spendId, { accountId: bolaAcct, months: 6 }, NOW)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  // ── Employer verification (Phase 5, heuristics only) ────────────────────

  describe("employer check", () => {
    const NOW = new Date("2026-09-22T12:00:00Z");
    let empN = 0;
    const makeApplicant = async (employer: string | null, over: Partial<typeof applicantProfiles.$inferInsert> = {}) => {
      empN += 1;
      const id = await makeCustomer(`Employer Test ${empN}`);
      await db.insert(applicantProfiles).values({
        userId: id,
        fullName: "Test Applicant",
        phone: `2348099${String(empN).padStart(6, "0")}`,
        employer,
        employmentType: "Private",
        ...over,
      });
      return id;
    };

    it("returns nulls throughout when no employer is declared", async () => {
      const id = await makeCustomer("No Profile At All");
      expect(await svc.employerCheck(id, NOW)).toEqual({ employer: null, employmentType: null, nameCheck: null, payment: null, sharedWith: null });

      const id2 = await makeApplicant(null);
      expect(await svc.employerCheck(id2, NOW)).toEqual({ employer: null, employmentType: "Private", nameCheck: null, payment: null, sharedWith: null });
    });

    it("flags a placeholder employer name as suspicious, and accepts an ordinary one", async () => {
      const placeholder = await makeApplicant("test");
      expect((await svc.employerCheck(placeholder, NOW)).nameCheck).toMatchObject({ suspicious: true });

      const real = await makeApplicant("Chisom Textiles Nigeria Ltd");
      expect((await svc.employerCheck(real, NOW)).nameCheck).toMatchObject({ suspicious: false });
    });

    it("matches the employer against the customer's own recurring salary credits", async () => {
      const id = await makeApplicant("Acme Foods Ltd");
      const acct = await makeAccount(id, `mono_emp_${empN}`);
      for (const m of ["2026-04", "2026-05", "2026-06"]) {
        await tx(id, acct, `emp_sal_${m}`, { narration: "NIP/ACME FOODS LTD/SALARY", amountKobo: 25_000_000n, occurredAt: new Date(`${m}-25T09:00:00Z`) });
      }
      const r = await svc.employerCheck(id, NOW);
      expect(r.payment?.matched).toBe(true);
      expect(r.payment?.source?.key).toContain("ACME");
    });

    it("reports unmatched — not a crash — when nothing in the bank data names the employer", async () => {
      const id = await makeApplicant("Acme Foods Ltd");
      const r = await svc.employerCheck(id, NOW);
      expect(r.payment).toEqual({ matched: false, source: null });
    });

    it("counts other applicants sharing the same employer text, case/whitespace-insensitively, and excludes the customer themself", async () => {
      const ids = [];
      for (let i = 0; i < 6; i++) ids.push(await makeApplicant(i === 0 ? "  Obscure Traders  " : "obscure traders"));
      const r = await svc.employerCheck(ids[0], NOW);
      expect(r.sharedWith).toEqual({ count: 5, flagged: true });
    });

    it("does not flag an employer used by only a couple of other applicants", async () => {
      const ids = [];
      for (let i = 0; i < 2; i++) ids.push(await makeApplicant("Uncommon Employer Co"));
      const r = await svc.employerCheck(ids[0], NOW);
      expect(r.sharedWith).toEqual({ count: 1, flagged: false });
    });
  });

  // ── Access policy ────────────────────────────────────────────────────────

  describe("role policy", () => {
    const rolesOf = (method: keyof CustomersController) =>
      Reflect.getMetadata(ROLES_KEY, CustomersController.prototype[method]) as string[] | undefined;
    const controllerRoles = Reflect.getMetadata(ROLES_KEY, CustomersController) as string[];

    it("keeps sales out of every read by inheriting the controller default", () => {
      expect(controllerRoles).not.toContain("sales");
      for (const m of ["transactions", "transaction", "statement", "incomeSources", "spendingAnalysis", "employerCheck"] as const) {
        expect(rolesOf(m)).toBeUndefined(); // no narrowing → inherits the default
      }
    });

    it("restricts raw responses and exports to admin and super_admin", () => {
      for (const m of ["rawResponses", "rawResponse", "exportTransactions"] as const) {
        expect(rolesOf(m)).toEqual(["super_admin", "admin"]);
      }
    });
  });
});
