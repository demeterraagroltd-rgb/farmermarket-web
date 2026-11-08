import "reflect-metadata";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import * as s from "@farmermarket/db";
import { createTestDb, type TestDb } from "../../test/test-db";
import { RecovaReconciliationService, paymentReportSchema } from "./recova-reconciliation.service";

describe("Recova payment reports with isolated SQL", () => {
  let test: TestDb; let db: s.Db; let service: RecovaReconciliationService;
  let reference: string; let orderId: string; let staffId: string; let scheduleId: string;
  beforeAll(async () => {
    test = await createTestDb(); db = test.db; service = new RecovaReconciliationService(db);
    const [user] = await db.insert(s.users).values({ fullName: "Test Borrower", phone: "08000000001" }).returning();
    [{ id: staffId }] = await db.insert(s.staff).values({ fullName: "Test Staff", email: "finance@example.test", passwordHash: "x", role: "admin" }).returning();
    const [plan] = await db.insert(s.bnplPlans).values({ name: "Test", durationMonths: 2 }).returning();
    [{ id: orderId }] = await db.insert(s.orders).values({ userId: user.id, bnplPlanId: plan.id, subtotalKobo: 100000n, totalKobo: 110000n, status: "confirmed", approvedAt: new Date() }).returning();
    const [schedule] = await db.insert(s.repaymentSchedules).values({ userId: user.id, orderId, amountKobo: 110000n, dueDate: new Date(Date.now() - 86400000), installmentNumber: 1, totalInstallments: 1 }).returning(); scheduleId = schedule.id;
    reference = `fm-live-${orderId}`;
    await db.insert(s.recovaConsents).values({ reference, userId: user.id, orderId, status: "active", purpose: "Collection", bankCode: "999", accountLast4: "0000", payloadEncrypted: "private-payload", approvalUrlEncrypted: "private-link", scheduleSnapshot: [], consentVersion: "test" });
  }, 60000);
  afterAll(async () => { await test?.close(); });
  const body = (transactionReference: string, amountNaira = "220.05") => ({ channel: "collection" as const, sourceName: "Recova", transactionReference, amountNaira, observedAt: new Date().toISOString(), note: "Statement awaiting review" });

  it("never presents an active mandate as proof of payment and never exposes consent capabilities", async () => {
    const overview = await service.overview();
    expect(overview).toMatchObject({ automaticPostingEnabled: false, providerPaymentVerificationEnabled: false });
    expect(overview.loans[0]).toMatchObject({ mandateStatus: "active", paidKobo: "0", outstandingKobo: "110000", repaymentStatus: "overdue_in_ledger" });
    expect(JSON.stringify(overview)).not.toMatch(/private-payload|private-link/);
  });
  it("stores exact kobo and audits a report without calling a provider or changing balances", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    try {
      const result = await service.report(reference, staffId, body("TX-ONE"));
      expect(result).toMatchObject({ ledgerChanged: false, status: "needs_verification" });
      const [report] = await db.select().from(s.recovaPaymentReports).where(eq(s.recovaPaymentReports.id, result.id));
      expect(report).toMatchObject({ amountKobo: 22005n, sourceName: "recova", transactionReference: "tx-one" });
      expect((await db.select().from(s.repaymentSchedules).where(eq(s.repaymentSchedules.id, scheduleId)))[0].amountPaidKobo).toBe(0n);
      expect(await db.select().from(s.repayments)).toHaveLength(0);
      expect(await db.select().from(s.ledgerEntries)).toHaveLength(0);
      expect(await db.select().from(s.auditLogs).where(eq(s.auditLogs.targetId, report.id))).toHaveLength(1);
      expect((await service.overview()).loans[0]).toMatchObject({ pendingReports: 1, reportedKobo: "22005", paidKobo: "0" });
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally { fetchSpy.mockRestore(); }
  });
  it("rejects duplicate source references even if submitted under another payment type", async () => {
    await expect(service.report(reference, staffId, { ...body("tx-one"), channel: "voluntary" })).rejects.toThrow("unresolved report");
    expect(await db.select().from(s.recovaPaymentReports)).toHaveLength(1);
  });
  it("dismisses a report once, preserves evidence and does not post a payment", async () => {
    const [report] = await db.select().from(s.recovaPaymentReports);
    await service.dismiss(report.id, staffId, "Wrong transaction supplied");
    await expect(service.dismiss(report.id, staffId, "Duplicate review attempt")).rejects.toThrow("already dismissed");
    expect((await service.detail(reference)).reports[0]).toMatchObject({ status: "dismissed", amountKobo: 22005n, dismissalReason: "Wrong transaction supplied" });
    expect((await service.overview()).loans[0].pendingReports).toBe(0);
    expect(await db.select().from(s.repayments)).toHaveLength(0);
    const correction = await service.report(reference, staffId, body("TX-ONE", "200.00"));
    expect(correction.id).not.toBe(report.id);
    expect(await db.select().from(s.recovaPaymentReports)).toHaveLength(2);
  });
  it("distinguishes real ledger part-payments and inconsistencies from provider verification", async () => {
    await db.insert(s.repayments).values({ repaymentScheduleId: scheduleId, amountKobo: 10000n });
    expect((await service.overview()).loans[0]).toMatchObject({ repaymentStatus: "ledger_review", ledgerConsistent: false });
    await db.update(s.repaymentSchedules).set({ amountPaidKobo: 10000n }).where(eq(s.repaymentSchedules.id, scheduleId));
    expect((await service.overview()).loans[0]).toMatchObject({ paidKobo: "10000", outstandingKobo: "100000", repaymentStatus: "part_paid_in_ledger", ledgerConsistent: true });
  });
  it("rejects invalid amounts, future dates and payments for unapproved orders", async () => {
    for (const amount of ["0", "-1", "1.001", "1e6", "NaN"]) expect(paymentReportSchema.safeParse(body("tx-invalid", amount)).success).toBe(false);
    await expect(service.report(reference, staffId, { ...body("tx-future"), observedAt: new Date(Date.now() + 3600000).toISOString() })).rejects.toThrow("future");
    await db.update(s.orders).set({ status: "pending_approval", approvedAt: null }).where(eq(s.orders.id, orderId));
    await expect(service.report(reference, staffId, body("tx-unapproved"))).rejects.toThrow("approved loan");
    await db.delete(s.repayments).where(eq(s.repayments.repaymentScheduleId, scheduleId));
    await db.delete(s.repaymentSchedules).where(eq(s.repaymentSchedules.id, scheduleId));
    expect((await service.overview()).loans[0]).toMatchObject({ repaymentStatus: "not_booked", outstandingKobo: null });
  });
});
