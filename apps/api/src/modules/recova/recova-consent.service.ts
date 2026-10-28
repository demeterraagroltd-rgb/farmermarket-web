import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { and, asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { applicantProfiles, bnplPlans, debitMandates, orders, recovaConsents, repaymentSchedules, type Db } from "@farmermarket/db";
import { DB } from "../../db/db.module";
import { decryptSecretOrNull, encryptSecret } from "../../common/crypto/reversible-secret";
import { AuthService } from "../auth/auth.service";
import { requestProductionConsent, requestProductionLookup } from "./recova.client";
import { assertConsentSubmissionEnabled, consentSetupStatus, CONSENT_VERSION, RECOVA_DATA_KEY, safeConsentUrl } from "./recova-consent.config";
import { buildInstallments, isPayNow } from "../orders/installments";

export const prepareConsentSchema = z.object({
  txnPin: z.string().regex(/^\d{4}$/),
  bankCode: z.string().regex(/^\d{3}$/),
  accountNumber: z.string().regex(/^\d{10}$/),
  accountOwnedByCustomer: z.literal(true),
  consentAccepted: z.literal(true),
}).strict();

type Consent = typeof recovaConsents.$inferSelect;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
const toNaira = (value: bigint) => {
  if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) throw new BadRequestException("Loan amount is outside the supported range.");
  return Number(value) / 100;
};
const object = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
/** Repayment is set up while the order awaits approval, or after it for older orders. */
const setupOpen = (order: typeof orders.$inferSelect) =>
  order.status === "pending_approval" || (!!order.approvedAt && !["cancelled", "rejected"].includes(order.status));
/** Tenure in the provider's unit, counted from when the order was placed. */
const loanTenure = (unit: string | undefined, order: typeof orders.$inferSelect, plan: typeof bnplPlans.$inferSelect, lastDue: Date) =>
  unit === "days" ? Math.ceil((lastDue.getTime() - order.placedAt.getTime()) / 86400000)
    : plan.durationDays ? Math.max(1, Math.ceil(plan.durationDays / 30)) : plan.durationMonths;
/** Staff-verified, or the customer's own BVN check matched their declared name and date of birth. */
const identityConfirmed = (profile: typeof applicantProfiles.$inferSelect) =>
  profile.verificationStatus === "verified"
  || (profile.verificationStatus === "submitted" && object(profile.identityLookup)?.verdict === "match");

@Injectable()
export class RecovaConsentService {
  constructor(@Inject(DB) private readonly db: Db, private readonly auth: AuthService) {}

  private async ownedOrder(userId: string, orderId: string, db: Db | Tx = this.db) {
    const [order] = await db.select().from(orders).where(and(eq(orders.id, orderId), eq(orders.userId, userId))).limit(1);
    if (!order) throw new NotFoundException("Order not found.");
    return order;
  }

  async status(userId: string, orderId: string) {
    const order = await this.ownedOrder(userId, orderId);
    const [consent] = await this.db.select().from(recovaConsents).where(eq(recovaConsents.orderId, orderId)).limit(1);
    const [plan] = await this.db.select().from(bnplPlans).where(eq(bnplPlans.id, order.bnplPlanId)).limit(1);
    const setup = consentSetupStatus();
    return { setup: { draftAvailable: setup.draftAvailable, submissionEnabled: setup.submissionEnabled, purpose: setup.purpose },
      eligible: setupOpen(order) && !!plan && !isPayNow(plan),
      consent: consent ? this.view(consent) : null };
  }

  private view(consent: Consent) {
    return { reference: consent.reference, status: consent.status, purpose: consent.purpose,
      accountLast4: consent.accountLast4, bankCode: consent.bankCode, schedule: consent.scheduleSnapshot,
      approvalUrl: ["awaiting_consent", "processing"].includes(consent.status)
        ? safeConsentUrl(decryptSecretOrNull(consent.approvalUrlEncrypted, RECOVA_DATA_KEY)) : null,
      checkedAt: consent.checkedAt, submittedAt: consent.submittedAt };
  }

  private async loan(userId: string, orderId: string, db: Db | Tx) {
    const order = await this.ownedOrder(userId, orderId, db);
    if (!setupOpen(order)) throw new BadRequestException("This order is closed, so repayment can't be set up for it.");
    const [plan] = await db.select().from(bnplPlans).where(eq(bnplPlans.id, order.bnplPlanId)).limit(1);
    if (!plan) throw new BadRequestException("Repayment plan is missing.");
    if (isPayNow(plan)) throw new BadRequestException("This order is paid up front, so it doesn't need repayment setup.");
    // Before approval the schedule is the one approval will write (dated from
    // when the order was placed); afterwards it is the stored schedule.
    const schedule = order.approvedAt
      ? await db.select().from(repaymentSchedules).where(and(eq(repaymentSchedules.orderId, orderId), eq(repaymentSchedules.userId, userId))).orderBy(asc(repaymentSchedules.dueDate))
      : buildInstallments(order.totalKobo, plan, order.placedAt).map(row => ({ ...row, isPaid: false, amountPaidKobo: 0n }));
    if (!schedule.length || schedule.some(row => row.isPaid || row.amountPaidKobo !== 0n || row.dueDate <= new Date()))
      throw new BadRequestException("Use a new loan with future installments and no existing payments. Existing debt requires reconciliation before onboarding.");
    const [mono] = await db.select({ id: debitMandates.id }).from(debitMandates).where(and(eq(debitMandates.userId, userId), inArray(debitMandates.status, ["awaiting_authorisation", "approved", "active", "paused"]))).limit(1);
    if (mono) throw new ConflictException("An existing Mono mandate must be resolved before setting up Recova repayment.");
    return { order, schedule, plan, snapshot: schedule.map(row => ({ dueDate: row.dueDate.toISOString(), amount: toNaira(row.amountKobo) })) };
  }

  async prepare(userId: string, orderId: string, input: z.infer<typeof prepareConsentSchema>) {
    input = prepareConsentSchema.parse(input);
    await this.auth.assertTxnPin(userId, input.txnPin);
    if (!consentSetupStatus().draftAvailable) throw new BadRequestException("Repayment setup is not available yet. Please contact support.");
    await this.db.transaction(async tx => {
      // Serialise preparations for this order; the unique index is a second defence.
      await tx.select({ id: orders.id }).from(orders).where(and(eq(orders.id, orderId), eq(orders.userId, userId))).for("update");
      await this.ownedOrder(userId, orderId, tx);
      const [existing] = await tx.select().from(recovaConsents).where(eq(recovaConsents.orderId, orderId)).limit(1);
      if (existing && existing.status !== "draft") throw new ConflictException("This loan already has a consent request. Refresh its status instead.");
      const { order, plan, snapshot, schedule } = await this.loan(userId, orderId, tx);
      const [profile] = await tx.select().from(applicantProfiles).where(eq(applicantProfiles.userId, userId)).limit(1);
      if (!profile || !identityConfirmed(profile)) throw new BadRequestException("Confirm your BVN from your account page first (we'll text a code to the phone linked to your BVN), then come back to set up repayment.");
      const bvn = decryptSecretOrNull(profile.bvnEncrypted);
      if (!bvn || !/^\d{11}$/.test(bvn)) throw new BadRequestException("Your verified BVN is unavailable. Please contact support to update your identity record.");
      if (!profile.email || !z.string().email().safeParse(profile.email).success) throw new BadRequestException("Add a valid email address to your profile first.");
      const config = consentSetupStatus();
      const reference = existing?.reference ?? `fm-live-${order.id}`;
      // Dates and amounts come exclusively from the approved server-side schedule.
      const payload = { bvn, loanReference: reference, customerID: userId, customerName: profile.fullName,
        customerEmail: profile.email, phoneNumber: profile.phone, loanAmount: toNaira(order.totalKobo),
        totalRepaymentExpected: toNaira(schedule.reduce((sum, row) => sum + row.amountKobo, 0n)),
        loanTenure: loanTenure(config.tenureUnit, order, plan, schedule.at(-1)!.dueDate),
        linkedAccountNumber: input.accountNumber, preferredRepaymentAccount: input.accountNumber,
        preferredRepaymentBankCBNCode: input.bankCode, repaymentType: config.purpose,
        collectionPaymentSchedules: snapshot.map(row => ({ repaymentDate: row.dueDate, repaymentAmountInNaira: row.amount })) };
      const values = { purpose: config.purpose, bankCode: input.bankCode, accountLast4: input.accountNumber.slice(-4),
        payloadEncrypted: encryptSecret(JSON.stringify(payload), RECOVA_DATA_KEY), scheduleSnapshot: snapshot,
        consentVersion: CONSENT_VERSION, consentedAt: new Date(), updatedAt: new Date() };
      if (existing) await tx.update(recovaConsents).set(values).where(eq(recovaConsents.id, existing.id));
      else await tx.insert(recovaConsents).values({ ...values, userId, orderId, reference });
    });
    return this.status(userId, orderId);
  }

  async submit(userId: string, orderId: string, pin: string) {
    await this.auth.assertTxnPin(userId, pin);
    const config = assertConsentSubmissionEnabled();
    const intent = await this.db.transaction(async tx => {
      await tx.select({ id: orders.id }).from(orders).where(and(eq(orders.id, orderId), eq(orders.userId, userId))).for("update");
      const { snapshot, order, plan, schedule } = await this.loan(userId, orderId, tx);
      const [consent] = await tx.select().from(recovaConsents).where(and(eq(recovaConsents.orderId, orderId), eq(recovaConsents.userId, userId))).limit(1);
      if (!consent || consent.status !== "draft") throw new ConflictException("Prepare this loan once, then refresh its status. A submitted request cannot be sent again.");
      const saved = z.array(z.object({ dueDate: z.string(), amount: z.number() })).parse(consent.scheduleSnapshot);
      if (JSON.stringify(saved.map(row => [row.dueDate, row.amount])) !== JSON.stringify(snapshot.map(row => [row.dueDate, row.amount])) || consent.purpose !== config.purpose)
        throw new ConflictException("The loan or setup configuration changed. Prepare repayment setup again.");
      const raw = decryptSecretOrNull(consent.payloadEncrypted, RECOVA_DATA_KEY);
      if (!raw) throw new BadRequestException("Saved repayment details are unavailable. Contact support.");
      const payload = JSON.parse(raw);
      // Tenure configuration may have changed since the draft. Do not silently
      // reinterpret it; preparation records the original value.
      const tenure = loanTenure(config.tenureUnit, order, plan, schedule.at(-1)!.dueDate);
      if (payload.loanTenure !== tenure) throw new ConflictException("Tenure configuration changed. Prepare setup again.");
      await tx.update(recovaConsents).set({ status: "submitting", submittedAt: new Date(), updatedAt: new Date() }).where(eq(recovaConsents.id, consent.id));
      return { consent, payload };
    });
    try {
      const response = await requestProductionConsent(intent.consent.reference, intent.payload);
      const body = object(response.body);
      const url = body?.loanReference === intent.consent.reference && body.customerID === userId && body.repaymentType === intent.consent.purpose
        ? safeConsentUrl(body.consentApprovalUrl) : null;
      const status = response.ok && url ? "awaiting_consent" : "needs_review";
      // A concurrent callback may already have advanced the state.
      await this.db.update(recovaConsents).set({ status, httpStatus: response.httpStatus,
        approvalUrlEncrypted: url ? encryptSecret(url, RECOVA_DATA_KEY) : null, updatedAt: new Date() })
        .where(and(eq(recovaConsents.id, intent.consent.id), eq(recovaConsents.status, "submitting")));
    } catch {
      await this.db.update(recovaConsents).set({ status: "needs_review", updatedAt: new Date() })
        .where(and(eq(recovaConsents.id, intent.consent.id), eq(recovaConsents.status, "submitting")));
      // Never retry a request whose provider outcome is unknown.
    }
    return this.status(userId, orderId);
  }

  async refresh(userId: string, orderId: string) {
    await this.ownedOrder(userId, orderId);
    const [consent] = await this.db.select().from(recovaConsents).where(and(eq(recovaConsents.orderId, orderId), eq(recovaConsents.userId, userId))).limit(1);
    if (!consent || consent.status === "draft") return this.status(userId, orderId);
    const result = await requestProductionLookup("mandate", consent.reference);
    const mandate = object(result.body);
    let status: string | null = null;
    // A callback, HTTP 200 or consent approval alone is not an active mandate.
    if (result.ok && mandate?.loanReference === consent.reference && String(mandate.customerID) === userId && mandate.repaymentType === consent.purpose) {
      const states: Record<string, string> = { Active: "active", Cancelled: "cancelled", Expired: "expired", Rejected: "failed", Pending: "processing" };
      status = typeof mandate.status === "string" ? states[mandate.status] ?? null : null;
    }
    if (!status) {
      const result = await requestProductionLookup("consent", consent.reference);
      const body = object(result.body);
      const url = body?.loanReference === consent.reference && body.customerID === userId ? safeConsentUrl(body.consentApprovalUrl) : null;
      const consentStates: Record<string, string> = { Initiated: "awaiting_consent", Approved: "processing", Declined: "failed", Expired: "expired" };
      const state = typeof body?.requestStatus === "string" ? consentStates[body.requestStatus] : null;
      if (result.ok && body?.loanReference === consent.reference && body.customerID === userId && body.repaymentType === consent.purpose && state) await this.db.update(recovaConsents).set({
        ...(url ? { approvalUrlEncrypted: encryptSecret(url, RECOVA_DATA_KEY) } : {}),
        status: state, checkedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(recovaConsents.id, consent.id), inArray(recovaConsents.status, ["submitting", "awaiting_consent", "needs_review"])));
    }
    if (status) await this.db.update(recovaConsents).set({ status, checkedAt: new Date(), updatedAt: new Date() }).where(eq(recovaConsents.id, consent.id));
    return this.status(userId, orderId);
  }
}
