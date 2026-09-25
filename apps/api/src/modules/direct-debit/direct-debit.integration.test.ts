import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { asc, eq, sql } from "drizzle-orm";
import { BadRequestException, ConflictException, ForbiddenException } from "@nestjs/common";
import {
  applicantProfiles,
  auditLogs,
  bankAccounts,
  bnplPlans,
  creditProfiles,
  debitAttempts,
  debitMandates,
  ledgerEntries,
  monoCustomers,
  orders,
  repaymentSchedules,
  repayments,
  staff,
  users,
  type Db,
} from "@farmermarket/db";
import { createTestDb, type TestDb } from "../../test/test-db";
import { encryptSecret } from "../../common/crypto/reversible-secret";
import { EmailService } from "../notifications/email.service";
import { LedgerService } from "../ledger/ledger.service";
import { WalletService } from "../wallet/wallet.service";
import { FakeDirectDebitClient } from "../integrations/mono-payments/fake-direct-debit.client";
import { DebitRateLimitedError } from "../integrations/mono-payments/direct-debit.types";
import { DirectDebitService } from "./direct-debit.service";

// Real SQL. The things worth proving here are the ones a mock would happily
// pass: that two collection passes racing each other send one debit, that a
// webhook delivered twice books the money once, and that a debit which lands
// after the installment was paid another way is flagged rather than booked.

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const BVN_KEY = Buffer.alloc(32, 6).toString("base64");
const PIN = "1234";

describe("Auto-debit (real Postgres)", () => {
  let t: TestDb;
  let db: Db;
  let client: FakeDirectDebitClient;
  let dd: DirectDebitService;
  let wallet: WalletService;
  let staffId: string;
  let planId: string;
  let n = 0;
  const saved = { enabled: process.env.AUTO_DEBIT_ENABLED, bvn: process.env.BVN_ENCRYPTION_KEY, env: process.env.NODE_ENV };

  const auth = {
    assertTxnPin: async (_id: string, pin: string) => {
      if (pin !== PIN) throw new ForbiddenException("Incorrect transaction code");
    },
  } as never;

  /** A customer with a linked bank, a profile, credit, and installments due yesterday. */
  const seed = async (over: { employer?: string; installments?: number[]; limitKobo?: bigint; profile?: boolean; bank?: boolean } = {}) => {
    n += 1;
    const phone = `23480${String(n).padStart(8, "0")}`;
    const [u] = await db.insert(users).values({ phone, fullName: "Ada Okonkwo", email: `ada${n}@example.com` }).returning();
    if (over.profile !== false) {
      await db.insert(applicantProfiles).values({
        userId: u.id,
        fullName: "Ada Okonkwo",
        phone,
        employer: over.employer ?? "Acme Foods Ltd",
        bvnEncrypted: encryptSecret("22222222222"),
        residentialAddress: { street: "1 Marina", city: "Lagos", state: "Lagos", lga: "Lagos Island" },
      });
    }
    if (over.bank !== false) {
      await db.insert(bankAccounts).values({ userId: u.id, monoAccountId: `acc_dd_${n}`, institution: "GTBank", accountNumberLast4: "4321" });
    }
    const amounts = over.installments ?? [5_000_000];
    const limit = over.limitKobo ?? 20_000_000n;
    const owed = BigInt(amounts.reduce((a, b) => a + b, 0));
    await db.insert(creditProfiles).values({
      userId: u.id,
      creditLimitKobo: limit,
      // (the schema forbids used > limit, though an installment book can outgrow a lowered limit)
      usedCreditKobo: owed < limit ? owed : limit,
      tier: "Gold",
      isVerified: true,
    });
    const [o] = await db
      .insert(orders)
      .values({ userId: u.id, status: "confirmed", subtotalKobo: 10_000_000n, totalKobo: 10_000_000n, bnplPlanId: planId, pickupCenterName: "Hub", pickupCenterAddress: "x" })
      .returning();
    const schedules = await db
      .insert(repaymentSchedules)
      .values(
        amounts.map((a, i) => ({
          orderId: o.id,
          userId: u.id,
          installmentNumber: i + 1,
          totalInstallments: amounts.length,
          amountKobo: BigInt(a),
          dueDate: new Date(Date.now() - DAY + i * 60_000),
        })),
      )
      .returning();
    return { userId: u.id, scheduleIds: schedules.map((s) => s.id), scheduleId: schedules[0].id };
  };

  const activate = async (userId: string, over: Partial<typeof debitMandates.$inferInsert> = {}) => {
    const [m] = await db
      .insert(debitMandates)
      .values({
        userId,
        monoCustomerId: "cus_x",
        monoMandateId: `mmd_${userId.slice(0, 8)}`,
        reference: `fm-mdt-${userId}`,
        status: "active",
        amountKobo: 30_000_000n,
        startDate: new Date(),
        endDate: new Date(Date.now() + 365 * DAY),
        ...over,
      })
      .returning();
    return m;
  };

  const attemptsOf = (scheduleId: string) =>
    db.select().from(debitAttempts).where(eq(debitAttempts.repaymentScheduleId, scheduleId)).orderBy(asc(debitAttempts.createdAt));
  const repaymentsOf = (scheduleId: string) => db.select().from(repayments).where(eq(repayments.repaymentScheduleId, scheduleId));
  const schedule = async (id: string) => (await db.select().from(repaymentSchedules).where(eq(repaymentSchedules.id, id)))[0];

  /** What Mono sends when a debit settles. */
  const successEvent = (mandateId: string, attempt: { reference: string; amountKobo: bigint }) => ({
    mandate: mandateId,
    reference_number: attempt.reference,
    amount: Number(attempt.amountKobo),
    fee: 5000,
    response_code: "00",
    status: "successful",
  });

  beforeAll(async () => {
    t = await createTestDb();
    db = t.db;
    [{ id: staffId }] = await db
      .insert(staff)
      .values({ email: "admin@example.com", passwordHash: "x", fullName: "Ada Admin", role: "admin" })
      .returning({ id: staff.id });
    [{ id: planId }] = await db.insert(bnplPlans).values({ name: "Pay Over 2 Months", durationMonths: 2 }).returning({ id: bnplPlans.id });
  }, 90_000);
  afterAll(async () => {
    for (const [k, v] of [
      ["AUTO_DEBIT_ENABLED", saved.enabled],
      ["BVN_ENCRYPTION_KEY", saved.bvn],
      ["NODE_ENV", saved.env],
    ] as const) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    await t.close();
  });
  beforeEach(async () => {
    process.env.AUTO_DEBIT_ENABLED = "true";
    process.env.BVN_ENCRYPTION_KEY = BVN_KEY;
    delete process.env.NODE_ENV;
    client = new FakeDirectDebitClient();
    const email = new EmailService();
    wallet = new WalletService(db, new LedgerService(), auth, email);
    dd = new DirectDebitService(db, client, wallet, auth, email);
    // A collection pass reads every due installment in the database, so leave
    // no other test's mandate active for this one to pick up.
    await db.update(debitMandates).set({ status: "cancelled" });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── setting up a mandate ───────────────────────────────────────────────

  describe("startMandate", () => {
    it("is unavailable while auto-debit is switched off", async () => {
      process.env.AUTO_DEBIT_ENABLED = "false";
      const { userId } = await seed();
      await expect(dd.startMandate(userId, PIN)).rejects.toBeInstanceOf(BadRequestException);
    });

    it("needs the customer's transaction PIN", async () => {
      const { userId } = await seed();
      await expect(dd.startMandate(userId, "0000")).rejects.toBeInstanceOf(ForbiddenException);
      expect(await db.select().from(debitMandates).where(eq(debitMandates.userId, userId))).toHaveLength(0);
    });

    it("creates the Mono customer and a capped, time-boxed mandate, and hands back the authorisation link", async () => {
      const spy = vi.spyOn(client, "initiateMandate");
      const { userId } = await seed({ limitKobo: 20_000_000n });
      const out = await dd.startMandate(userId, PIN, new Date("2026-09-25T10:00:00Z"));
      expect(out.authorisationUrl).toMatch(/authorise/);

      const [m] = await db.select().from(debitMandates).where(eq(debitMandates.userId, userId));
      expect(m).toMatchObject({ status: "awaiting_authorisation", amountKobo: 25_000_000n, collectedKobo: 0n });
      expect(m.endDate.toISOString().slice(0, 10)).toBe("2027-09-25");
      expect(spy.mock.calls[0][0]).toMatchObject({ amountKobo: 25_000_000, startDate: "2026-09-25", endDate: "2027-09-25" });
      expect(await db.select().from(monoCustomers).where(eq(monoCustomers.userId, userId))).toHaveLength(1);
    });

    it("sizes the cap to what's already owed when that's more than the limit plus headroom", async () => {
      const { userId } = await seed({ limitKobo: 1_000_000n, installments: [30_000_000] });
      await dd.startMandate(userId, PIN);
      const [m] = await db.select().from(debitMandates).where(eq(debitMandates.userId, userId));
      expect(m.amountKobo).toBe(30_000_000n);
    });

    it("resumes the same link on a second tap instead of creating a second mandate", async () => {
      const spy = vi.spyOn(client, "createCustomer");
      const { userId } = await seed();
      const first = await dd.startMandate(userId, PIN);
      const second = await dd.startMandate(userId, PIN);
      expect(second).toEqual({ authorisationUrl: first.authorisationUrl, resumed: true });
      expect(spy).toHaveBeenCalledTimes(1);
      expect(await db.select().from(debitMandates).where(eq(debitMandates.userId, userId))).toHaveLength(1);
    });

    it("starts over once the hour to authorise has passed", async () => {
      const { userId } = await seed();
      await dd.startMandate(userId, PIN, new Date());
      await dd.startMandate(userId, PIN, new Date(Date.now() + 2 * HOUR));
      const rows = await db.select().from(debitMandates).where(eq(debitMandates.userId, userId));
      expect(rows.map((r) => r.status).sort()).toEqual(["awaiting_authorisation", "cancelled"]);
    });

    it("refuses when automatic repayment is already active", async () => {
      const { userId } = await seed();
      await activate(userId);
      await expect(dd.startMandate(userId, PIN)).rejects.toBeInstanceOf(ConflictException);
    });

    it("reuses an existing Mono customer rather than creating a second", async () => {
      const spy = vi.spyOn(client, "createCustomer");
      const { userId } = await seed();
      await db.insert(monoCustomers).values({ userId, monoCustomerId: "cus_existing" });
      await dd.startMandate(userId, PIN);
      expect(spy).not.toHaveBeenCalled();
      const [m] = await db.select().from(debitMandates).where(eq(debitMandates.userId, userId));
      expect(m.monoCustomerId).toBe("cus_existing");
    });

    it("needs a linked bank account and a complete profile", async () => {
      const noBank = await seed({ bank: false });
      await expect(dd.startMandate(noBank.userId, PIN)).rejects.toThrow(/Link the bank account/);
      const noProfile = await seed({ profile: false });
      await expect(dd.startMandate(noProfile.userId, PIN)).rejects.toThrow(/Complete your profile/);
    });

    it("never persists or forwards more than it should: the BVN goes to Mono only", async () => {
      const spy = vi.spyOn(client, "createCustomer");
      const { userId } = await seed();
      await dd.startMandate(userId, PIN);
      expect(spy.mock.calls[0][0]).toMatchObject({ bvn: "22222222222", firstName: "Ada", lastName: "Okonkwo" });
      const [m] = await db.select().from(debitMandates).where(eq(debitMandates.userId, userId));
      expect(JSON.stringify(m, (_k, v) => (typeof v === "bigint" ? v.toString() : v))).not.toContain("22222222222");
    });
  });

  // ── mandate webhooks ───────────────────────────────────────────────────

  describe("mandate events", () => {
    it("moves awaiting → approved → active, matching first by our reference, then by Mono's id", async () => {
      const { userId } = await seed();
      await dd.startMandate(userId, PIN);
      const [m0] = await db.select().from(debitMandates).where(eq(debitMandates.userId, userId));

      expect(await dd.processEvent("events.mandates.approved", { id: "mmd_1", reference: m0.reference })).toBe("handled");
      let [m] = await db.select().from(debitMandates).where(eq(debitMandates.userId, userId));
      expect(m).toMatchObject({ status: "approved", monoMandateId: "mmd_1" });

      expect(await dd.processEvent("events.mandates.ready", { id: "mmd_1", ready_to_debit: true })).toBe("handled");
      [m] = await db.select().from(debitMandates).where(eq(debitMandates.userId, userId));
      expect(m.status).toBe("active");
      expect(m.readyAt).not.toBeNull();
    });

    it("can go straight to active if 'ready' arrives before 'approved'", async () => {
      const { userId } = await seed();
      await dd.startMandate(userId, PIN);
      const [m0] = await db.select().from(debitMandates).where(eq(debitMandates.userId, userId));
      await dd.processEvent("events.mandates.ready", { id: "mmd_2", reference: m0.reference });
      const [m] = await db.select().from(debitMandates).where(eq(debitMandates.userId, userId));
      expect(m).toMatchObject({ status: "active", monoMandateId: "mmd_2" });
    });

    it("is unmoved by a repeat, and never resurrects a cancelled mandate", async () => {
      const { userId } = await seed();
      const m = await activate(userId);
      expect(await dd.processEvent("events.mandates.ready", { id: m.monoMandateId })).toBe("ignored");
      await dd.processEvent("events.mandate.action.cancel", { mandate: m.monoMandateId });
      // Found, but a cancelled mandate is left cancelled.
      expect(await dd.processEvent("events.mandates.ready", { id: m.monoMandateId })).toBe("ignored");
      const [row] = await db.select().from(debitMandates).where(eq(debitMandates.id, m.id));
      expect(row.status).toBe("cancelled");
    });

    it("records a bank rejection with its reason, pause and reinstate, and expiry", async () => {
      const a = await seed();
      await dd.startMandate(a.userId, PIN);
      const [ma] = await db.select().from(debitMandates).where(eq(debitMandates.userId, a.userId));
      await dd.processEvent("events.mandates.rejected", { reference: ma.reference, message: "Mandate was rejected by Bank" });
      expect((await db.select().from(debitMandates).where(eq(debitMandates.id, ma.id)))[0]).toMatchObject({ status: "rejected", statusReason: "Mandate was rejected by Bank" });

      const b = await seed();
      const mb = await activate(b.userId);
      await dd.processEvent("events.mandate.action.pause", { mandate: mb.monoMandateId });
      expect((await db.select().from(debitMandates).where(eq(debitMandates.id, mb.id)))[0].status).toBe("paused");
      await dd.processEvent("events.mandate.action.reinstate", { mandate: mb.monoMandateId });
      expect((await db.select().from(debitMandates).where(eq(debitMandates.id, mb.id)))[0].status).toBe("active");
      await dd.processEvent("events.mandates.expired", { id: mb.monoMandateId });
      expect((await db.select().from(debitMandates).where(eq(debitMandates.id, mb.id)))[0].status).toBe("expired");
    });

    it("ignores events it doesn't know", async () => {
      expect(await dd.processEvent("events.something.else", {})).toBe("ignored");
      expect(await dd.processEvent("events.mandates.approved", { id: "nobody" })).toBe("unmatched");
    });
  });

  // ── collecting ─────────────────────────────────────────────────────────

  describe("collectDue", () => {
    it("does nothing at all while auto-debit is switched off", async () => {
      process.env.AUTO_DEBIT_ENABLED = "false";
      const { userId } = await seed();
      await activate(userId);
      const out = await dd.collectDue();
      expect(out).toMatchObject({ enabled: false, candidates: 0, attempted: 0 });
      expect(client.debits).toHaveLength(0);
    });

    it("refuses to run against the fake rail in production", async () => {
      process.env.NODE_ENV = "production";
      const { userId, scheduleId } = await seed();
      await activate(userId);
      const out = await dd.collectDue();
      expect(out).toMatchObject({ enabled: true, blocked: true, attempted: 0 });
      expect(client.debits).toHaveLength(0);
      expect(await attemptsOf(scheduleId)).toHaveLength(0);
    });

    it("debits what's due, once, and leaves it processing until the bank confirms", async () => {
      const { userId, scheduleId } = await seed({ installments: [5_000_000] });
      const m = await activate(userId);
      const out = await dd.collectDue();
      expect(out).toMatchObject({ candidates: 1, attempted: 1, errors: 0 });

      expect(client.debits).toHaveLength(1);
      expect(client.debits[0]).toMatchObject({ mandateId: m.monoMandateId, input: { amountKobo: 5_000_000, narration: "Farmer Market installment 1/1" } });
      const [a] = await attemptsOf(scheduleId);
      expect(a).toMatchObject({ status: "processing", amountKobo: 5_000_000n, attemptNumber: 1, trigger: "scheduled" });
      expect(a.sentAt).not.toBeNull();
      expect(a.reference).toBe(client.debits[0].input.reference);

      // Nothing is booked until Mono says the money moved.
      expect(await repaymentsOf(scheduleId)).toHaveLength(0);
      expect((await schedule(scheduleId)).isPaid).toBe(false);

      // A second pass finds it in flight and sends nothing.
      const again = await dd.collectDue();
      expect(again).toMatchObject({ attempted: 0, skipped: { in_flight: 1 } });
      expect(client.debits).toHaveLength(1);
    });

    it("sends exactly one debit when two passes race", async () => {
      const { userId, scheduleId } = await seed();
      await activate(userId);
      const [a, b] = await Promise.all([dd.collectDue(), dd.collectDue()]);
      expect(client.debits).toHaveLength(1);
      expect(await attemptsOf(scheduleId)).toHaveLength(1);
      expect(a.attempted + b.attempted).toBe(1);
    });

    it("skips what isn't ready: not due, below Mono's minimum, no active mandate, FCDA payroll", async () => {
      const future = await seed();
      await db.update(repaymentSchedules).set({ dueDate: new Date(Date.now() + 5 * DAY) }).where(eq(repaymentSchedules.id, future.scheduleId));
      await activate(future.userId);

      const tiny = await seed({ installments: [19_999] });
      await activate(tiny.userId);

      const noMandate = await seed();
      await activate(noMandate.userId, { status: "approved" }); // approved, not ready

      const fcda = await seed({ employer: "FCDA" });
      await activate(fcda.userId);

      const out = await dd.collectDue();
      expect(client.debits).toHaveLength(0);
      expect(out.skipped).toMatchObject({ below_minimum: 1, fcda_payroll: 1 });
      // (the not-due row isn't even a candidate; the approved-only mandate isn't joined)
      expect(out.attempted).toBe(0);
    });

    it("debits a part-paid installment only for what's still owed", async () => {
      const { userId, scheduleId } = await seed({ installments: [5_000_000] });
      await db.update(repaymentSchedules).set({ amountPaidKobo: 2_000_000n }).where(eq(repaymentSchedules.id, scheduleId));
      await activate(userId);
      await dd.collectDue();
      expect(client.debits[0].input.amountKobo).toBe(3_000_000);
    });

    it("never takes more than the customer authorised, across a customer's installments in one pass", async () => {
      const { userId, scheduleIds } = await seed({ installments: [5_000_000, 5_000_000] });
      await activate(userId, { amountKobo: 7_000_000n }); // room for one, not both
      const out = await dd.collectDue();
      expect(client.debits).toHaveLength(1);
      expect(out.skipped.mandate_cap_reached).toBe(1);
      expect((await attemptsOf(scheduleIds[0])).length + (await attemptsOf(scheduleIds[1])).length).toBe(1);
    });

    it("previews without sending when asked for a dry run", async () => {
      const { userId, scheduleId } = await seed();
      await activate(userId);
      const out = await dd.collectDue(new Date(), { dryRun: true });
      expect(out.attempted).toBe(1);
      expect(client.debits).toHaveLength(0);
      expect(await attemptsOf(scheduleId)).toHaveLength(0);
    });
  });

  // ── settling: the money ────────────────────────────────────────────────

  describe("a confirmed debit", () => {
    it("books the repayment once — schedule, credit, ledger and mandate all move together", async () => {
      const { userId, scheduleId } = await seed({ installments: [5_000_000] });
      const m = await activate(userId);
      await dd.collectDue();
      const [a] = await attemptsOf(scheduleId);

      expect(await dd.processEvent("events.mandates.debit.successful", successEvent(m.monoMandateId!, a))).toBe("handled");

      const [after] = await attemptsOf(scheduleId);
      expect(after).toMatchObject({ status: "successful", responseCode: "00", feeKobo: 5000n });
      expect(after.repaymentId).not.toBeNull();
      expect(await schedule(scheduleId)).toMatchObject({ isPaid: true, amountPaidKobo: 5_000_000n });
      const [profile] = await db.select().from(creditProfiles).where(eq(creditProfiles.userId, userId));
      expect(profile.usedCreditKobo).toBe(0n);
      const [mandate] = await db.select().from(debitMandates).where(eq(debitMandates.id, m.id));
      expect(mandate.collectedKobo).toBe(5_000_000n);

      const legs = await db.select().from(ledgerEntries).where(eq(ledgerEntries.repaymentId, after.repaymentId!));
      expect(legs).toHaveLength(2);
      expect(legs.map((l) => l.direction).sort()).toEqual(["C", "D"]);
    });

    it("books it exactly once however many times Mono delivers the webhook", async () => {
      const { userId, scheduleId } = await seed();
      const m = await activate(userId);
      await dd.collectDue();
      const [a] = await attemptsOf(scheduleId);
      const event = successEvent(m.monoMandateId!, a);
      await Promise.all([dd.processEvent("events.mandates.debit.successful", event), dd.processEvent("events.mandates.debit.successful", event)]);
      await dd.processEvent("events.mandates.debit.successful", event);

      expect(await repaymentsOf(scheduleId)).toHaveLength(1);
      // The repeats must leave the recorded attempt exactly as it was — not re-judge it.
      const [settled] = await attemptsOf(scheduleId);
      expect(settled.status).toBe("successful");
      expect(settled.repaymentId).not.toBeNull();
      expect(settled.failureReason).toBeNull();
      const [mandate] = await db.select().from(debitMandates).where(eq(debitMandates.id, m.id));
      expect(mandate.collectedKobo).toBe(5_000_000n);
      const [profile] = await db.select().from(creditProfiles).where(eq(creditProfiles.userId, userId));
      expect(profile.usedCreditKobo).toBe(0n);
    });

    it("records at once when Mono answers 'successful' to the debit request itself", async () => {
      client.failNextDebitWith({ outcome: "successful", responseCode: "00", message: null, feeKobo: 5000, providerReference: "ref_1" });
      const { userId, scheduleId } = await seed();
      await activate(userId);
      await dd.collectDue();
      expect((await attemptsOf(scheduleId))[0]).toMatchObject({ status: "successful", providerReference: "ref_1" });
      expect(await repaymentsOf(scheduleId)).toHaveLength(1);
    });

    it("matches Mono's webhook on its own reference, or by mandate and amount when it echoes neither of ours", async () => {
      const a = await seed();
      const ma = await activate(a.userId);
      await dd.collectDue();
      const [att] = await attemptsOf(a.scheduleId);
      await db.update(debitAttempts).set({ providerReference: "MONO-REF-1" }).where(eq(debitAttempts.id, att.id));
      await dd.processEvent("events.mandates.debit.successful", { mandate: ma.monoMandateId, reference_number: "MONO-REF-1", amount: 5_000_000, response_code: "00" });
      expect((await attemptsOf(a.scheduleId))[0].status).toBe("successful");

      const b = await seed();
      const mb = await activate(b.userId);
      await dd.collectDue();
      await dd.processEvent("events.mandates.debit.successful", { mandate: mb.monoMandateId, reference_number: "SOMETHING-ELSE", amount: 5_000_000, response_code: "00" });
      expect((await attemptsOf(b.scheduleId))[0].status).toBe("successful");
    });

    it("says so when it can't match a debit to anything, rather than guessing", async () => {
      expect(await dd.processEvent("events.mandates.debit.successful", { mandate: "mmd_nobody", reference_number: "?", amount: 1 })).toBe("unmatched");
    });

    it("flags — and does not book — a debit that lands after the installment was paid another way", async () => {
      const { userId, scheduleId } = await seed({ installments: [5_000_000] });
      const m = await activate(userId);
      await dd.collectDue();
      const [a] = await attemptsOf(scheduleId);
      // The customer's own payment got there first (the admin route isn't blocked by an in-flight debit).
      await wallet.recordRepayment(scheduleId, 50_000).catch(() => undefined);
      await db.transaction(async (tx) => wallet.applyRepaymentTx(tx, scheduleId, 5_000_000n));

      await dd.processEvent("events.mandates.debit.successful", successEvent(m.monoMandateId!, a));

      const [after] = await attemptsOf(scheduleId);
      expect(after.status).toBe("needs_review");
      expect(after.failureReason).toMatch(/refund needed/);
      expect(after.repaymentId).toBeNull();
      expect(await repaymentsOf(scheduleId)).toHaveLength(1); // only the manual one
      const [mandate] = await db.select().from(debitMandates).where(eq(debitMandates.id, m.id));
      expect(mandate.collectedKobo).toBe(0n);
    });

    it("still books money that arrives for an attempt we'd already written off as failed", async () => {
      const { userId, scheduleId } = await seed();
      const m = await activate(userId);
      await dd.collectDue();
      const [a] = await attemptsOf(scheduleId);
      await dd.processEvent("events.mandates.debit.failed", { mandate: m.monoMandateId, reference_number: a.reference, response_code: "51" });
      expect((await attemptsOf(scheduleId))[0].status).toBe("failed");

      await dd.processEvent("events.mandates.debit.successful", successEvent(m.monoMandateId!, a));
      expect((await attemptsOf(scheduleId))[0].status).toBe("successful");
      expect(await repaymentsOf(scheduleId)).toHaveLength(1);
    });

    it("ignores a 'failed' that arrives after the debit succeeded", async () => {
      const { userId, scheduleId } = await seed();
      const m = await activate(userId);
      await dd.collectDue();
      const [a] = await attemptsOf(scheduleId);
      await dd.processEvent("events.mandates.debit.successful", successEvent(m.monoMandateId!, a));
      await dd.processEvent("events.mandates.debit.failed", { mandate: m.monoMandateId, reference_number: a.reference, response_code: "51" });
      expect((await attemptsOf(scheduleId))[0].status).toBe("successful");
    });
  });

  // ── failures & retries ────────────────────────────────────────────────

  describe("a failed debit", () => {
    const failEvent = (mandateId: string, reference: string, code = "51") => ({ mandate: mandateId, reference_number: reference, response_code: code, status: "failed" });

    it("is recorded with a plain reason and retried the next day, not straight away", async () => {
      const { userId, scheduleId } = await seed();
      const m = await activate(userId);
      await dd.collectDue();
      const [a] = await attemptsOf(scheduleId);
      await dd.processEvent("events.mandates.debit.failed", failEvent(m.monoMandateId!, a.reference));
      expect((await attemptsOf(scheduleId))[0]).toMatchObject({ status: "failed", responseCode: "51", failureReason: "there wasn't enough money in the account" });

      expect(await dd.collectDue()).toMatchObject({ attempted: 0, skipped: { retry_wait: 1 } });
      const tomorrow = await dd.collectDue(new Date(Date.now() + 25 * HOUR));
      expect(tomorrow.attempted).toBe(1);
      const attempts = await attemptsOf(scheduleId);
      expect(attempts.map((x) => x.attemptNumber)).toEqual([1, 2]);
    });

    it("records a refusal in the debit response itself", async () => {
      client.failNextDebitWith({ outcome: "failed", responseCode: "51", message: "Insufficient funds", feeKobo: null, providerReference: null });
      const { userId, scheduleId } = await seed();
      await activate(userId);
      await dd.collectDue();
      expect((await attemptsOf(scheduleId))[0]).toMatchObject({ status: "failed", responseCode: "51" });
      expect(await repaymentsOf(scheduleId)).toHaveLength(0);
    });

    it("stops after the maximum attempts and leaves the installment to collections", async () => {
      const { userId, scheduleId } = await seed();
      const m = await activate(userId);
      let clock = Date.now();
      for (let i = 0; i < 4; i++) {
        clock += 25 * HOUR;
        await dd.collectDue(new Date(clock));
        const last = (await attemptsOf(scheduleId)).at(-1)!;
        await dd.processEvent("events.mandates.debit.failed", failEvent(m.monoMandateId!, last.reference));
      }
      expect(await attemptsOf(scheduleId)).toHaveLength(4);
      clock += 100 * HOUR;
      expect(await dd.collectDue(new Date(clock))).toMatchObject({ attempted: 0, skipped: { attempts_exhausted: 1 } });
      expect(client.debits).toHaveLength(4);
    });

    it("treats a rate limit as no attempt at all — waits a day, keeps the customer's tries", async () => {
      client.failNextDebitWith(new DebitRateLimitedError());
      const { userId, scheduleId } = await seed();
      await activate(userId);
      await dd.collectDue();
      expect((await attemptsOf(scheduleId))[0]).toMatchObject({ status: "failed", responseCode: "RL" });
      expect(await dd.collectDue()).toMatchObject({ attempted: 0, skipped: { retry_wait: 1 } });
    });

    it("never retries a request it can't tell whether Mono received — it goes to a person", async () => {
      client.failNextDebitWith(new Error("socket hang up"));
      const { userId, scheduleId } = await seed();
      await activate(userId);
      const out = await dd.collectDue();
      expect(out.attempted).toBe(1);
      expect((await attemptsOf(scheduleId))[0]).toMatchObject({ status: "needs_review" });

      const later = await dd.collectDue(new Date(Date.now() + 10 * DAY));
      expect(later).toMatchObject({ attempted: 0, skipped: { needs_review: 1 } });
      expect(client.debits).toHaveLength(1);
    });

    it("a staff resolution unblocks the installment", async () => {
      client.failNextDebitWith(new Error("timeout"));
      const { userId, scheduleId } = await seed();
      await activate(userId);
      await dd.collectDue();
      const [a] = await attemptsOf(scheduleId);

      await dd.resolveReview(a.id, staffId, "confirmed with Mono: never processed");
      expect((await attemptsOf(scheduleId))[0]).toMatchObject({ status: "failed", responseCode: "RL" });
      const [log] = await db.select().from(auditLogs).where(eq(auditLogs.action, "customer.auto_debit_review_resolved"));
      expect(log).toMatchObject({ actorStaffId: staffId, targetId: userId });

      expect((await dd.collectDue(new Date(Date.now() + 25 * HOUR))).attempted).toBe(1);
      await expect(dd.resolveReview(a.id, staffId, "again")).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  // ── not letting the two rails collide ─────────────────────────────────

  describe("manual payment", () => {
    it("is refused while an automatic debit for that installment is in flight", async () => {
      const { userId, scheduleId } = await seed();
      await activate(userId);
      await dd.collectDue();
      await expect(wallet.payRepayment(userId, scheduleId, { amountNaira: 50_000, txnPin: PIN })).rejects.toBeInstanceOf(ConflictException);
      expect(await repaymentsOf(scheduleId)).toHaveLength(0);
    });

    it("works as before when no debit is in flight", async () => {
      const { userId, scheduleId } = await seed();
      await wallet.payRepayment(userId, scheduleId, { amountNaira: 50_000, txnPin: PIN });
      expect(await repaymentsOf(scheduleId)).toHaveLength(1);
      expect((await schedule(scheduleId)).isPaid).toBe(true);
    });

    it("can't be double-applied by two payments at once — the schedule row is locked", async () => {
      const { scheduleId } = await seed({ installments: [5_000_000] });
      const results = await Promise.allSettled([
        db.transaction((tx) => wallet.applyRepaymentTx(tx, scheduleId, 5_000_000n)),
        db.transaction((tx) => wallet.applyRepaymentTx(tx, scheduleId, 5_000_000n)),
      ]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(await repaymentsOf(scheduleId)).toHaveLength(1);
    });
  });

  // ── housekeeping ──────────────────────────────────────────────────────

  describe("reconcileStale", () => {
    it("drops an attempt never sent, reviews one sent but unanswered, and reviews one stuck processing for days", async () => {
      const mk = async (over: Partial<typeof debitAttempts.$inferInsert>) => {
        const { userId, scheduleId } = await seed();
        const m = await activate(userId);
        const [a] = await db
          .insert(debitAttempts)
          .values({ repaymentScheduleId: scheduleId, mandateId: m.id, userId, attemptNumber: 1, reference: `r-${Math.random()}`, amountKobo: 5_000_000n, ...over })
          .returning();
        return a.id;
      };
      const old = new Date(Date.now() - 2 * HOUR);
      const unsent = await mk({ status: "initiated", createdAt: old });
      const unanswered = await mk({ status: "initiated", createdAt: old, sentAt: old });
      const stuck = await mk({ status: "processing", sentAt: new Date(Date.now() - 4 * DAY) });
      const fresh = await mk({ status: "processing", sentAt: new Date() });

      expect(await dd.reconcileStale(new Date())).toBe(3);
      const status = async (id: string) => (await db.select().from(debitAttempts).where(eq(debitAttempts.id, id)))[0].status;
      expect([await status(unsent), await status(unanswered), await status(stuck), await status(fresh)]).toEqual(["failed", "needs_review", "needs_review", "processing"]);
    });
  });

  describe("cancel", () => {
    it("tells Mono, stops future debits, and audits a staff cancellation", async () => {
      const { userId } = await seed();
      const m = await activate(userId);
      await dd.cancel(userId, { staffId });
      expect(client.cancelled).toEqual([m.monoMandateId]);
      expect((await db.select().from(debitMandates).where(eq(debitMandates.id, m.id)))[0]).toMatchObject({ status: "cancelled", statusReason: "cancelled by staff" });
      expect((await dd.collectDue()).attempted).toBe(0);
      const [log] = await db.select().from(auditLogs).where(eq(auditLogs.action, "customer.auto_debit_cancelled"));
      expect(log.targetId).toBe(userId);
    });

    it("has nothing to cancel without a live mandate", async () => {
      const { userId } = await seed();
      await expect(dd.cancel(userId)).rejects.toThrow(/nothing to cancel|no automatic repayment/i);
    });

    it("a debit already in flight still settles after the mandate is cancelled", async () => {
      const { userId, scheduleId } = await seed();
      const m = await activate(userId);
      await dd.collectDue();
      const [a] = await attemptsOf(scheduleId);
      await dd.cancel(userId);
      await dd.processEvent("events.mandates.debit.successful", successEvent(m.monoMandateId!, a));
      expect(await repaymentsOf(scheduleId)).toHaveLength(1);
    });
  });

  describe("status", () => {
    it("shows the mandate and recent attempts, exposing the link only while it's needed", async () => {
      const { userId } = await seed();
      await dd.startMandate(userId, PIN);
      const s = await dd.status(userId);
      expect(s.available).toBe(true);
      expect(s.mandate).toMatchObject({ status: "awaiting_authorisation" });
      expect(s.mandate!.authorisationUrl).toMatch(/authorise/);

      const [m] = await db.select().from(debitMandates).where(eq(debitMandates.userId, userId));
      await dd.processEvent("events.mandates.ready", { id: "mmd_s", reference: m.reference });
      expect((await dd.status(userId)).mandate!.authorisationUrl).toBeNull();
    });
  });

  it("the database itself refuses a second in-flight attempt for one installment", async () => {
    const { userId, scheduleId } = await seed();
    const m = await activate(userId);
    const row = { repaymentScheduleId: scheduleId, mandateId: m.id, userId, attemptNumber: 1, amountKobo: 5_000_000n, status: "processing" as const };
    await db.insert(debitAttempts).values({ ...row, reference: "dup-a" });
    await expect(db.insert(debitAttempts).values({ ...row, reference: "dup-b", attemptNumber: 2 })).rejects.toThrow();
    await db.execute(sql`select 1`);
  });
});
