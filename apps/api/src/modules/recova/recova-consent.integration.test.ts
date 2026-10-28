import "reflect-metadata";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { applicantProfiles, auditLogs, bnplPlans, orders, recovaCallbacks, recovaConsents, repaymentSchedules, staff, users, type Db } from "@farmermarket/db";
import { createTestDb, type TestDb } from "../../test/test-db";
import { decryptSecretOrNull, encryptSecret } from "../../common/crypto/reversible-secret";
import { RecovaConsentService } from "./recova-consent.service";
import { consentSetupStatus, RECOVA_DATA_KEY, safeConsentUrl } from "./recova-consent.config";
import { authenticateRecovaCallback, RecovaWebhookController } from "./recova-webhook.controller";
import { RecovaProductionController } from "./recova-production.controller";
import { OrdersService } from "../orders/orders.service";
import { LedgerService } from "../ledger/ledger.service";

describe("Recova customer consent with real isolated SQL", () => {
  let test: TestDb; let db: Db; let service: RecovaConsentService;
  let userId: string; let otherId: string; let orderId: string; let scheduleId: string;
  const auth = { assertTxnPin: vi.fn().mockResolvedValue(undefined) };
  const input = { txnPin: "1234", bankCode: "999", accountNumber: "0123456789", accountOwnedByCustomer: true as const, consentAccepted: true as const };
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeAll(async () => {
    vi.stubEnv("BVN_ENCRYPTION_KEY", Buffer.alloc(32, 1).toString("base64"));
    vi.stubEnv(RECOVA_DATA_KEY, Buffer.alloc(32, 2).toString("base64"));
    test = await createTestDb(); db = test.db;
    const [user, other] = await db.insert(users).values([{ phone: "08000000001" }, { phone: "08000000002" }]).returning();
    userId = user.id; otherId = other.id;
    await db.insert(applicantProfiles).values({ userId, fullName: "Test Customer", phone: "08000000001", email: "test@example.test", verificationStatus: "verified", bvnEncrypted: encryptSecret("00000000001") });
    const [plan] = await db.insert(bnplPlans).values({ name: "Test 3 months", durationMonths: 3 }).returning();
    const [order] = await db.insert(orders).values({ userId, bnplPlanId: plan.id, status: "confirmed", subtotalKobo: 6000000n, totalKobo: 6000000n, approvedAt: new Date() }).returning();
    orderId = order.id;
    const [schedule] = await db.insert(repaymentSchedules).values({ orderId, userId, installmentNumber: 1, totalInstallments: 1, amountKobo: 6600000n, dueDate: new Date(Date.now() + 90 * 86400000) }).returning();
    scheduleId = schedule.id;
    service = new RecovaConsentService(db, auth as never);
  }, 60000);
  afterAll(async () => { await test?.close(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
  beforeEach(async () => {
    await db.delete(recovaCallbacks); await db.delete(recovaConsents);
    await db.update(repaymentSchedules).set({ amountPaidKobo: 0n }).where(eq(repaymentSchedules.id, scheduleId));
    vi.stubEnv("RECOVA_PRODUCTION_ENABLED", "true"); vi.stubEnv("RECOVA_PRODUCTION_BASE_URL", "https://recova.ng/fixture/api");
    vi.stubEnv("RECOVA_PRODUCTION_API_TOKEN", "fixture-secret"); vi.stubEnv("RECOVA_PRODUCTION_INSTITUTION_CODE", "223");
    vi.stubEnv("RECOVA_CONSENT_ENABLED", "false"); vi.stubEnv("RECOVA_CONTRACT_CONFIRMED", "true");
    vi.stubEnv("RECOVA_CONSENT_PURPOSE", "Collection"); vi.stubEnv("RECOVA_TENURE_UNIT", "months");
    vi.stubEnv("RECOVA_WEBHOOKS_ENABLED", "true"); vi.stubEnv("RECOVA_WEBHOOK_SECRET", "fixture-callback-secret-of-at-least-32-chars");
    vi.stubEnv("AUTO_DEBIT_ENABLED", "false");
    fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock); auth.assertTxnPin.mockResolvedValue(undefined);
  });
  const reference = () => `fm-live-${orderId}`;
  const prepare = () => service.prepare(userId, orderId, input);
  const live = () => vi.stubEnv("RECOVA_CONSENT_ENABLED", "true");
  const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

  it("prepares a private encrypted draft using the server schedule without making a provider call", async () => {
    const view = await prepare();
    expect(view.consent).toMatchObject({ reference: reference(), status: "draft", accountLast4: "6789", schedule: [{ amount: 66000 }] });
    const [row] = await db.select().from(recovaConsents);
    expect(row.payloadEncrypted).not.toContain(input.accountNumber);
    expect(JSON.stringify(view)).not.toContain(input.accountNumber);
    expect(JSON.stringify(view)).not.toContain("00000000001");
    expect(fetchMock).not.toHaveBeenCalled();
    await prepare(); expect(await db.select().from(recovaConsents)).toHaveLength(1);
  });
  it("rejects another customer's order and incorrect PIN", async () => {
    await expect(service.status(otherId, orderId)).rejects.toThrow("Order not found");
    await expect(service.prepare(otherId, orderId, input)).rejects.toThrow("Order not found");
    auth.assertTxnPin.mockRejectedValueOnce(new Error("Incorrect transaction code"));
    await expect(prepare()).rejects.toThrow("Incorrect transaction code");
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("blocks all production submissions by default", async () => {
    await prepare();
    await expect(service.submit(userId, orderId, "1234")).rejects.toThrow("not enabled");
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("submits at most once and returns only a safe provider consent link", async () => {
    await prepare(); live();
    fetchMock.mockResolvedValue(response({ loanReference: reference(), customerID: userId, repaymentType: "Collection", consentApprovalUrl: "https://recova.ng/consent/example" }));
    const result = await service.submit(userId, orderId, "1234");
    expect(result.consent).toMatchObject({ status: "awaiting_consent", approvalUrl: "https://recova.ng/consent/example" });
    const payload = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(payload).toMatchObject({ loanAmount: 60000, totalRepaymentExpected: 66000, customerID: userId, repaymentType: "Collection", loanTenure: 3 });
    await expect(service.submit(userId, orderId, "1234")).rejects.toThrow("cannot be sent again");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("retains an ambiguous intent across service restarts rather than retrying a POST", async () => {
    await prepare(); live(); fetchMock.mockRejectedValue(new Error("timeout"));
    expect((await service.submit(userId, orderId, "1234")).consent?.status).toBe("needs_review");
    const restarted = new RecovaConsentService(db, auth as never);
    await expect(restarted.submit(userId, orderId, "1234")).rejects.toThrow("cannot be sent again");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("rejects changed schedules and loans already partly repaid", async () => {
    await prepare(); live();
    await db.update(repaymentSchedules).set({ amountPaidKobo: 100n }).where(eq(repaymentSchedules.id, scheduleId));
    await expect(service.submit(userId, orderId, "1234")).rejects.toThrow("no existing payments");
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("does not treat HTTP 200, another customer's mandate or an unrelated reference as active", async () => {
    await prepare(); await db.update(recovaConsents).set({ status: "needs_review" });
    fetchMock.mockImplementation(async () => response({ loanReference: reference(), customerID: otherId, repaymentType: "Collection", status: "Active" }));
    expect((await service.refresh(userId, orderId)).consent?.status).toBe("needs_review");
    fetchMock.mockImplementation(async () => response({ loanReference: "another-loan", customerID: userId, repaymentType: "Collection", status: "Active" }));
    expect((await service.refresh(userId, orderId)).consent?.status).toBe("needs_review");
  });
  it("verifies active mandate status without changing any repayment balance", async () => {
    await prepare(); await db.update(recovaConsents).set({ status: "awaiting_consent" });
    fetchMock.mockResolvedValue(response({ loanReference: reference(), customerID: userId, repaymentType: "Collection", status: "Active" }));
    expect((await service.refresh(userId, orderId)).consent?.status).toBe("active");
    const [row] = await db.select().from(repaymentSchedules).where(eq(repaymentSchedules.id, scheduleId));
    expect(row.amountPaidKobo).toBe(0n);
  });
  it("rejects unsafe links and disabled or nonmatching callback secrets", () => {
    expect(safeConsentUrl("javascript:alert(1)")).toBeNull();
    expect(safeConsentUrl("https://recova.ng.evil.example/consent")).toBeNull();
    expect(safeConsentUrl("https://staging.recova.ng/consent")).toBeNull();
    expect(() => authenticateRecovaCallback("wrong")).toThrow();
    vi.stubEnv("RECOVA_WEBHOOKS_ENABLED", "false");
    expect(() => authenticateRecovaCallback(process.env.RECOVA_WEBHOOK_SECRET)).toThrow();
  });
  it("routes SMS only to the matching customer and deduplicates callback retries", async () => {
    await prepare(); await db.update(recovaConsents).set({ status: "awaiting_consent" });
    const sender = { live: true, send: vi.fn().mockResolvedValue(undefined) };
    const hook = new RecovaWebhookController(db, service, sender);
    const body = { loanReference: reference(), institutionCode: "223", phoneNumber: "2348000000001", message: "Approve your repayment mandate" };
    await expect(hook.sendSms(process.env.RECOVA_WEBHOOK_SECRET, { ...body, phoneNumber: "2348000000002" })).rejects.toThrow("Recipient");
    await hook.sendSms(process.env.RECOVA_WEBHOOK_SECRET, body);
    expect(await hook.sendSms(process.env.RECOVA_WEBHOOK_SECRET, body)).toMatchObject({ duplicate: true });
    expect(sender.send).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(await db.select().from(recovaCallbacks))).not.toContain(body.message);
    // The same message after the retry window is a deliberate resend.
    await db.update(recovaCallbacks).set({ createdAt: new Date(Date.now() - 11 * 60 * 1000) });
    expect(await hook.sendSms(process.env.RECOVA_WEBHOOK_SECRET, body)).toEqual({ ok: true });
    expect(sender.send).toHaveBeenCalledTimes(2);
    expect(await hook.sendSms(process.env.RECOVA_WEBHOOK_SECRET, body)).toMatchObject({ duplicate: true });
  });
  it("lets staff resend a waiting consent's token at most once per cooldown", async () => {
    await prepare(); live(); await db.update(recovaConsents).set({ status: "awaiting_consent" });
    const [staffMember] = await db.insert(staff).values({ email: "resend@example.test", fullName: "Staff", passwordHash: "x", role: "admin" }).returning();
    const controller = new RecovaProductionController(db);
    fetchMock.mockResolvedValue(response({ status: true }));
    const result = await controller.resend(reference(), { staffId: staffMember.id } as never);
    expect(result).toMatchObject({ ok: true, operation: "resend-consent" });
    expect(fetchMock).toHaveBeenCalledWith(`https://recova.ng/fixture/api/ConsentRequest/ResendConsentRequestMessage/${reference()}`, expect.objectContaining({ method: "POST" }));
    await expect(controller.resend(reference(), { staffId: staffMember.id } as never)).rejects.toThrow("less than 2 minutes");
    await db.update(recovaConsents).set({ status: "active" }); await db.delete(auditLogs);
    await expect(controller.resend(reference(), { staffId: staffMember.id } as never)).rejects.toThrow("still waiting");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  describe("ordering before staff approval", () => {
    const kyc = { getVerificationStatus: async () => "verified" };
    const ordersService = () => new OrdersService(db, new LedgerService(), auth as never, kyc as never, { send: vi.fn().mockResolvedValue(undefined) } as never);
    let staffId: string;
    beforeAll(async () => {
      [{ id: staffId }] = await db.insert(staff).values({ email: "approver@example.test", fullName: "Approver", passwordHash: "x", role: "admin" }).returning();
    });
    async function pendingOrder() {
      const [plan] = await db.insert(bnplPlans).values({ name: "Test: repay tomorrow", durationMonths: 0, durationDays: 1, testOnly: true }).returning();
      const placedAt = new Date(Date.now() - 60 * 60 * 1000);
      const [order] = await db.insert(orders).values({ userId, bnplPlanId: plan.id, status: "pending_approval", subtotalKobo: 100000n, totalKobo: 100000n, placedAt }).returning();
      await db.update(applicantProfiles).set({ verificationStatus: "submitted", identityLookup: { verdict: "match" } }).where(eq(applicantProfiles.userId, userId));
      return { order, placedAt, ref: `fm-live-${order.id}` };
    }
    afterAll(async () => { await db.update(applicantProfiles).set({ verificationStatus: "verified", identityLookup: null }).where(eq(applicantProfiles.userId, userId)); });

    it("sets up the mandate on the dates approval will write, then approves only once it is active", async () => {
      const { order, placedAt, ref } = await pendingOrder(); live();
      const dueDate = new Date(placedAt.getTime() + 86400000).toISOString();
      expect((await service.prepare(userId, order.id, input)).consent?.schedule).toEqual([{ dueDate, amount: 1000 }]);
      fetchMock.mockResolvedValue(response({ loanReference: ref, customerID: userId, repaymentType: "Collection", consentApprovalUrl: "https://recova.ng/consent/x" }));
      await service.submit(userId, order.id, "1234");
      expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ loanTenure: 1, collectionPaymentSchedules: [{ repaymentDate: dueDate, repaymentAmountInNaira: 1000 }] });
      await expect(ordersService().approve(order.id, staffId)).rejects.toThrow("isn't active");
      await db.update(recovaConsents).set({ status: "active" }).where(eq(recovaConsents.reference, ref));
      await ordersService().approve(order.id, staffId);
      const [row] = await db.select().from(repaymentSchedules).where(eq(repaymentSchedules.orderId, order.id));
      expect(row.dueDate.toISOString()).toBe(dueDate);
    });
    it("asks unconfirmed customers to confirm their BVN before setting up", async () => {
      const { order } = await pendingOrder();
      await db.update(applicantProfiles).set({ identityLookup: { verdict: "partial" } }).where(eq(applicantProfiles.userId, userId));
      await expect(service.prepare(userId, order.id, input)).rejects.toThrow("Confirm your BVN");
    });
    it("cancels the Recova mandate when the order is rejected, and keeps the order if Recova can't confirm", async () => {
      const { order, ref } = await pendingOrder();
      await service.prepare(userId, order.id, input);
      await db.update(recovaConsents).set({ status: "active" }).where(eq(recovaConsents.reference, ref));
      fetchMock.mockResolvedValue(response("error", 500));
      await expect(ordersService().reject(order.id, staffId, "Documents unclear")).rejects.toThrow("did not confirm");
      expect((await db.select().from(orders).where(eq(orders.id, order.id)))[0].status).toBe("pending_approval");
      fetchMock.mockResolvedValue(response({ status: true }));
      await ordersService().reject(order.id, staffId, "Documents unclear");
      expect(fetchMock.mock.calls.at(-1)![0]).toContain(`/Mandate/CancelMandateByLoanReference/${ref}`);
      expect((await db.select().from(recovaConsents).where(eq(recovaConsents.reference, ref)))[0].status).toBe("cancelled");
      expect((await db.select().from(orders).where(eq(orders.id, order.id)))[0].status).toBe("rejected");
    });
  });
  it("requires agreed contract settings and prevents simultaneous Mono collection", () => {
    live(); expect(consentSetupStatus().submissionEnabled).toBe(true);
    vi.stubEnv("AUTO_DEBIT_ENABLED", "true"); expect(consentSetupStatus().submissionEnabled).toBe(false);
    vi.stubEnv("AUTO_DEBIT_ENABLED", "false"); vi.stubEnv("RECOVA_CONTRACT_CONFIRMED", "false"); expect(consentSetupStatus().submissionEnabled).toBe(false);
  });
  it("does not advance a mandate merely because a callback claims it was created", async () => {
    await prepare(); await db.update(recovaConsents).set({ status: "needs_review" });
    fetchMock.mockImplementation(async () => response("not found", 404));
    const hook = new RecovaWebhookController(db, service, { live: false, send: vi.fn() });
    const body = { loanReference: reference(), institutionCode: "223" };
    await expect(hook.mandate("wrong", body)).rejects.toThrow();
    await expect(hook.mandate(process.env.RECOVA_WEBHOOK_SECRET, { ...body, institutionCode: "167" })).rejects.toThrow();
    await expect(hook.mandate(process.env.RECOVA_WEBHOOK_SECRET, body)).rejects.toThrow("not confirmed");
    expect((await service.status(userId, orderId)).consent?.status).toBe("needs_review");
    expect(await db.select().from(recovaCallbacks)).toHaveLength(0);
  });
  it("reuses the account from a previous setup on a new order without the customer re-entering it", async () => {
    const [plan] = await db.select().from(bnplPlans).limit(1);
    const [second] = await db.insert(orders).values({ userId, bnplPlanId: plan.id, status: "confirmed", subtotalKobo: 100000n, totalKobo: 100000n, approvedAt: new Date() }).returning();
    await db.insert(repaymentSchedules).values({ orderId: second.id, userId, installmentNumber: 1, totalInstallments: 1, amountKobo: 100000n, dueDate: new Date(Date.now() + 86400000) });
    // Nothing to reuse before the first order has been through Recova.
    expect((await service.status(userId, second.id)).savedAccount).toBeNull();
    await expect(service.prepare(userId, second.id, { txnPin: "1234", useSavedAccount: true, accountOwnedByCustomer: true, consentAccepted: true }))
      .rejects.toThrow("couldn't find your previous repayment account");
    await prepare();
    await db.update(recovaConsents).set({ status: "active" }).where(eq(recovaConsents.orderId, orderId));
    const offered = await service.status(userId, second.id);
    expect(offered.savedAccount).toEqual({ bankCode: "999", accountLast4: "6789" });
    expect(JSON.stringify(offered)).not.toContain(input.accountNumber);
    const view = await service.prepare(userId, second.id, { txnPin: "1234", useSavedAccount: true, accountOwnedByCustomer: true, consentAccepted: true });
    expect(view.consent).toMatchObject({ reference: `fm-live-${second.id}`, status: "draft", bankCode: "999", accountLast4: "6789" });
    const [row] = await db.select().from(recovaConsents).where(eq(recovaConsents.orderId, second.id));
    const payload = JSON.parse(decryptSecretOrNull(row.payloadEncrypted, RECOVA_DATA_KEY)!);
    expect(payload).toMatchObject({ preferredRepaymentAccount: input.accountNumber, preferredRepaymentBankCBNCode: "999", loanReference: `fm-live-${second.id}` });
    expect(fetchMock).not.toHaveBeenCalled();
    // Other customers never see this customer's saved account.
    await expect(service.status(otherId, second.id)).rejects.toThrow("Order not found");
  });
});
