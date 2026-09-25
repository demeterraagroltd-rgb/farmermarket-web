import { randomUUID } from "node:crypto";
import { BadRequestException, ConflictException, Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { and, desc, eq, inArray, lt, lte, or, sql } from "drizzle-orm";
import { koboToNaira } from "@farmermarket/core";
import {
  applicantProfiles,
  auditLogs,
  bankAccounts,
  creditProfiles,
  debitAttempts,
  debitMandates,
  monoCustomers,
  repaymentSchedules,
  users,
  type Db,
} from "@farmermarket/db";
import { DB } from "../../db/db.module";
import { decryptSecretOrNull } from "../../common/crypto/reversible-secret";
import { AuthService } from "../auth/auth.service";
import { EmailService } from "../notifications/email.service";
import { customerLinks } from "../notifications/links";
import { emails } from "../notifications/templates";
import { WalletService } from "../wallet/wallet.service";
import {
  DIRECT_DEBIT_CLIENT,
  DebitRateLimitedError,
  type DirectDebitClient,
} from "../integrations/mono-payments/direct-debit.types";
import {
  MAX_ATTEMPTS,
  NOT_COUNTED_CODE,
  decideDebit,
  failureExplanation,
  mandateCapKobo,
  type AttemptHistory,
  type DebitDecision,
} from "./debit-policy";

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

const HOUR = 3_600_000;
const MIN = 60_000;

/** A mandate awaiting the customer's ₦50 authorisation transfer lapses at Mono after an hour. */
const AUTHORISATION_WINDOW_MS = 55 * MIN;
/** An attempt recorded but never sent is safe to discard after this long (the process died before the request left). */
const UNSENT_ATTEMPT_MS = 10 * MIN;
/** An attempt that *was* sent but never answered is reviewed by a person, not retried. */
const UNANSWERED_ATTEMPT_MS = 30 * MIN;
/** Mono retries webhooks for 48 hours; a debit still "processing" well past that needs a human. */
const PROCESSING_TIMEOUT_MS = 72 * HOUR;

const CONCURRENCY = 3;

const errCode = (e: unknown): string | undefined => {
  const x = e as { code?: string; cause?: { code?: string } };
  return x?.code ?? x?.cause?.code;
};
const short = (e: unknown): string => (e instanceof Error ? e.message : String(e)).replace(/\s+/g, " ").slice(0, 200);
const ymd = (d: Date) => d.toISOString().slice(0, 10);
const naira = (kobo: bigint) => koboToNaira(kobo).toLocaleString("en-NG", { style: "currency", currency: "NGN" });

const LIVE_STATUSES = ["awaiting_authorisation", "approved", "active", "paused"] as const;

export interface CollectSummary {
  enabled: boolean;
  /** True when auto-debit is on but refused to run (a fake rail in production). */
  blocked: boolean;
  candidates: number;
  attempted: number;
  skipped: Record<string, number>;
  errors: number;
  reconciled: number;
}

export type SettleInput =
  | { outcome: "success"; responseCode?: string | null; feeKobo?: bigint | null; providerReference?: string | null }
  | { outcome: "failure"; responseCode?: string | null; message?: string | null; providerReference?: string | null };

/**
 * Auto-debit: one Mono variable mandate per customer, then a debit for each
 * installment on (or after) its due date.
 *
 * Three rules everything below is built around:
 *  1. Money is recorded only when Mono says it moved — never on our own say-so.
 *  2. A debit is never sent twice for one installment: the attempt row is
 *     written first and a unique index allows one in flight per installment.
 *  3. If we can't tell whether money moved (a request that timed out, a payment
 *     that lands after the installment was settled another way) the attempt goes
 *     to `needs_review` and nothing retries it — a person decides.
 */
@Injectable()
export class DirectDebitService {
  private readonly log = new Logger("DirectDebit");

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(DIRECT_DEBIT_CLIENT) private readonly client: DirectDebitClient,
    private readonly wallet: WalletService,
    private readonly auth: AuthService,
    private readonly email: EmailService,
  ) {}

  /** Confirms a customer's transaction PIN — the consent gate for anything that changes what we may debit. */
  authenticate(userId: string, txnPin: string) {
    return this.auth.assertTxnPin(userId, txnPin);
  }

  /** The master switch. Off by default: deploying this code moves no money until someone turns it on. */
  isEnabled(): boolean {
    return process.env.AUTO_DEBIT_ENABLED === "true";
  }

  /** A fake rail must never "collect" in production — it would record repayments for money that never moved. */
  private railIsSafe(): boolean {
    return this.client.live || process.env.NODE_ENV !== "production";
  }

  // ── Reading ─────────────────────────────────────────────────────────────

  private async liveMandate(userId: string) {
    const [m] = await this.db
      .select()
      .from(debitMandates)
      .where(and(eq(debitMandates.userId, userId), inArray(debitMandates.status, [...LIVE_STATUSES])))
      .limit(1);
    return m ?? null;
  }

  async status(userId: string) {
    const mandate = (await this.liveMandate(userId)) ?? (await this.latestMandate(userId));
    const attempts = await this.db
      .select({
        id: debitAttempts.id,
        status: debitAttempts.status,
        amountKobo: debitAttempts.amountKobo,
        attemptNumber: debitAttempts.attemptNumber,
        responseCode: debitAttempts.responseCode,
        failureReason: debitAttempts.failureReason,
        trigger: debitAttempts.trigger,
        createdAt: debitAttempts.createdAt,
        completedAt: debitAttempts.completedAt,
        installmentNumber: repaymentSchedules.installmentNumber,
        totalInstallments: repaymentSchedules.totalInstallments,
        dueDate: repaymentSchedules.dueDate,
      })
      .from(debitAttempts)
      .innerJoin(repaymentSchedules, eq(debitAttempts.repaymentScheduleId, repaymentSchedules.id))
      .where(eq(debitAttempts.userId, userId))
      .orderBy(desc(debitAttempts.createdAt))
      .limit(20);
    return {
      available: this.isEnabled(),
      mandate: mandate && {
        id: mandate.id,
        status: mandate.status,
        amountKobo: mandate.amountKobo,
        collectedKobo: mandate.collectedKobo,
        startDate: mandate.startDate,
        endDate: mandate.endDate,
        authorisationUrl: mandate.status === "awaiting_authorisation" ? mandate.authorisationUrl : null,
        statusReason: mandate.statusReason,
        readyAt: mandate.readyAt,
        createdAt: mandate.createdAt,
      },
      attempts,
    };
  }

  private async latestMandate(userId: string) {
    const [m] = await this.db.select().from(debitMandates).where(eq(debitMandates.userId, userId)).orderBy(desc(debitMandates.createdAt)).limit(1);
    return m ?? null;
  }

  // ── Setting up a mandate ────────────────────────────────────────────────

  /**
   * The customer's consent step: they confirm with their transaction PIN, and we
   * return the Mono link where they authorise the mandate at their bank. What
   * they authorise is capped (their credit limit plus headroom for interest) and
   * time-boxed (a year) — never open-ended.
   */
  async startMandate(userId: string, txnPin: string, now: Date = new Date()) {
    if (!this.isEnabled()) throw new BadRequestException("Automatic repayment isn't available yet.");
    await this.auth.assertTxnPin(userId, txnPin);

    const existing = await this.liveMandate(userId);
    if (existing) {
      const fresh = now.getTime() - existing.createdAt.getTime() < AUTHORISATION_WINDOW_MS;
      if (existing.status === "awaiting_authorisation" && fresh && existing.authorisationUrl) {
        return { authorisationUrl: existing.authorisationUrl, resumed: true };
      }
      if (existing.status === "awaiting_authorisation") {
        // The hour to authorise has passed; Mono will have cancelled it.
        await this.db
          .update(debitMandates)
          .set({ status: "cancelled", statusReason: "authorisation window lapsed", endedAt: now, updatedAt: now })
          .where(eq(debitMandates.id, existing.id));
      } else {
        throw new ConflictException("Automatic repayment is already set up on your account.");
      }
    }

    const [user] = await this.db.select().from(users).where(eq(users.id, userId)).limit(1);
    const [profile] = await this.db.select().from(applicantProfiles).where(eq(applicantProfiles.userId, userId)).limit(1);
    const [account] = await this.db
      .select({ id: bankAccounts.id })
      .from(bankAccounts)
      .where(and(eq(bankAccounts.userId, userId), eq(bankAccounts.status, "active")))
      .limit(1);
    if (!account) throw new BadRequestException("Link the bank account you're repaid from before turning on automatic repayment.");

    const bvn = profile?.bvnEncrypted ? decryptSecretOrNull(profile.bvnEncrypted) : null;
    const addr = profile?.residentialAddress as { street?: string; city?: string; state?: string } | null;
    const address = addr ? [addr.street, addr.city, addr.state].filter(Boolean).join(", ") : "";
    const nameParts = (profile?.fullName ?? user?.fullName ?? "").trim().split(/\s+/).filter(Boolean);
    if (!user?.email || !profile?.phone || !address || !bvn || nameParts.length < 2) {
      throw new BadRequestException("Complete your profile (full name, email, phone, address and BVN) before turning on automatic repayment.");
    }

    const [limitRow] = await this.db.select({ limit: creditProfiles.creditLimitKobo }).from(creditProfiles).where(eq(creditProfiles.userId, userId)).limit(1);
    const [{ owed }] = await this.db
      .select({ owed: sql<string>`coalesce(sum(${repaymentSchedules.amountKobo} - ${repaymentSchedules.amountPaidKobo}), 0)` })
      .from(repaymentSchedules)
      .where(and(eq(repaymentSchedules.userId, userId), eq(repaymentSchedules.isPaid, false)));
    const cap = mandateCapKobo(limitRow?.limit ?? 0n, BigInt(owed));
    if (cap <= 0n) throw new BadRequestException("You don't have any credit to repay yet, so there's nothing to set up.");

    // Mono keeps one customer per person and refuses a duplicate, so reuse ours.
    let [mc] = await this.db.select().from(monoCustomers).where(eq(monoCustomers.userId, userId)).limit(1);
    if (!mc) {
      const created = await this.client.createCustomer({
        firstName: nameParts[0],
        lastName: nameParts.slice(1).join(" "),
        email: user.email,
        phone: profile.phone,
        address,
        bvn,
      });
      // Tolerate only the same customer racing themselves. Mono handing back an
      // id that already belongs to someone else is not a race — it must fail loudly.
      await this.db
        .insert(monoCustomers)
        .values({ userId, monoCustomerId: created.customerId })
        .onConflictDoNothing({ target: monoCustomers.userId });
      [mc] = await this.db.select().from(monoCustomers).where(eq(monoCustomers.userId, userId)).limit(1);
    }

    const reference = `fm-mdt-${randomUUID()}`;
    const endDate = new Date(now);
    endDate.setUTCFullYear(endDate.getUTCFullYear() + 1);
    const started = await this.client.initiateMandate({
      customerId: mc.monoCustomerId,
      amountKobo: Number(cap),
      reference,
      description: "Farmer Market installment repayments",
      startDate: ymd(now),
      endDate: ymd(endDate),
      redirectUrl: customerLinks.repayments(),
    });

    try {
      await this.db.insert(debitMandates).values({
        userId,
        bankAccountId: account.id,
        monoCustomerId: mc.monoCustomerId,
        monoMandateId: started.mandateId,
        reference,
        amountKobo: cap,
        startDate: now,
        endDate,
        authorisationUrl: started.authorisationUrl,
      });
    } catch (e) {
      // Two taps at once: the one-live-mandate index lets only one through.
      if (errCode(e) === "23505") throw new ConflictException("Automatic repayment is already being set up — check for the link we sent.");
      throw e;
    }
    return { authorisationUrl: started.authorisationUrl, resumed: false };
  }

  /** Stops future debits. Customer- or staff-initiated; a debit already in flight still settles. */
  async cancel(userId: string, opts: { staffId?: string; reason?: string } = {}) {
    const mandate = await this.liveMandate(userId);
    if (!mandate) throw new NotFoundException("There's no automatic repayment to cancel.");
    if (mandate.monoMandateId) await this.client.cancelMandate(mandate.monoMandateId);
    const now = new Date();
    await this.db
      .update(debitMandates)
      .set({ status: "cancelled", statusReason: opts.reason ?? (opts.staffId ? "cancelled by staff" : "cancelled by customer"), endedAt: now, updatedAt: now })
      .where(eq(debitMandates.id, mandate.id));
    if (opts.staffId) {
      await this.db.insert(auditLogs).values({
        actorStaffId: opts.staffId,
        action: "customer.auto_debit_cancelled",
        targetType: "user",
        targetId: userId,
        metadata: { mandateId: mandate.id, reason: opts.reason ?? null },
      });
    }
  }

  // ── Webhooks ────────────────────────────────────────────────────────────

  /**
   * Applies one Mono direct-debit event. Safe to call twice with the same event:
   * every transition is guarded by the row's current state, and money is only
   * ever recorded once per attempt (see {@link settle}).
   */
  async processEvent(event: string, data: Record<string, unknown> | undefined): Promise<"handled" | "ignored" | "unmatched"> {
    const d = (data ?? {}) as Record<string, unknown>;
    const str = (v: unknown) => (typeof v === "string" && v ? v : null);
    const now = new Date();

    const mandateBy = async (id: string | null, reference: string | null) => {
      if (id) {
        const [m] = await this.db.select().from(debitMandates).where(eq(debitMandates.monoMandateId, id)).limit(1);
        if (m) return m;
      }
      if (reference) {
        const [m] = await this.db.select().from(debitMandates).where(eq(debitMandates.reference, reference)).limit(1);
        if (m) return m;
      }
      return null;
    };

    switch (event) {
      case "events.mandates.approved":
      case "events.mandates.ready": {
        const m = await mandateBy(str(d.id), str(d.reference));
        if (!m) return "unmatched";
        const ready = event === "events.mandates.ready" || d.ready_to_debit === true;
        // Only ever move forward from a state that can still become active.
        if (!["awaiting_authorisation", "approved"].includes(m.status)) return "ignored";
        await this.db
          .update(debitMandates)
          .set({
            monoMandateId: m.monoMandateId ?? str(d.id),
            status: ready ? "active" : "approved",
            approvedAt: m.approvedAt ?? now,
            readyAt: ready ? now : m.readyAt,
            updatedAt: now,
          })
          .where(eq(debitMandates.id, m.id));
        return "handled";
      }
      case "events.mandates.rejected":
      case "events.mandates.expired": {
        const m = await mandateBy(str(d.id), str(d.reference));
        if (!m) return "unmatched";
        if (!LIVE_STATUSES.includes(m.status as (typeof LIVE_STATUSES)[number])) return "ignored";
        await this.db
          .update(debitMandates)
          .set({
            monoMandateId: m.monoMandateId ?? str(d.id),
            status: event.endsWith("rejected") ? "rejected" : "expired",
            statusReason: str(d.message),
            endedAt: now,
            updatedAt: now,
          })
          .where(eq(debitMandates.id, m.id));
        return "handled";
      }
      case "events.mandate.action.cancel":
      case "events.mandate.action.pause":
      case "events.mandate.action.reinstate": {
        const m = await mandateBy(str(d.mandate) ?? str(d.id), null);
        if (!m) return "unmatched";
        const status = event.endsWith("cancel") ? "cancelled" : event.endsWith("pause") ? "paused" : "active";
        if (status === "active" && m.status !== "paused") return "ignored";
        if (status !== "active" && !LIVE_STATUSES.includes(m.status as (typeof LIVE_STATUSES)[number])) return "ignored";
        await this.db
          .update(debitMandates)
          .set({ status, statusReason: str(d.message), endedAt: status === "cancelled" ? now : null, updatedAt: now })
          .where(eq(debitMandates.id, m.id));
        return "handled";
      }
      case "events.mandates.debit.processing":
        return "ignored"; // the attempt is already "processing" from when we sent it
      case "events.mandates.debit.successful":
      case "events.mandates.debit.failed": {
        const attempt = await this.attemptFor(d);
        if (!attempt) {
          this.log.error(`Mono reported a ${event} we can't match to any attempt (${str(d.reference_number) ?? str(d.reference) ?? "no reference"}) — needs a manual look.`);
          return "unmatched";
        }
        const code = str(d.response_code);
        const provider = str(d.reference_number);
        if (event.endsWith("successful")) {
          await this.settle(attempt.id, { outcome: "success", responseCode: code ?? "00", feeKobo: typeof d.fee === "number" ? BigInt(Math.round(d.fee)) : null, providerReference: provider });
        } else {
          await this.settle(attempt.id, { outcome: "failure", responseCode: code, message: str(d.message), providerReference: provider });
        }
        return "handled";
      }
      default:
        return "ignored";
    }
  }

  /** Mono's debit webhooks don't promise to echo our reference, so try every id it might carry, then fall back to the one debit that fits. */
  private async attemptFor(d: Record<string, unknown>) {
    const refs = [d.reference, d.reference_number, (d.meta as { reference?: unknown } | undefined)?.reference].filter(
      (v): v is string => typeof v === "string" && v.length > 0,
    );
    if (refs.length) {
      const [byRef] = await this.db
        .select()
        .from(debitAttempts)
        .where(or(inArray(debitAttempts.reference, refs), inArray(debitAttempts.providerReference, refs)))
        .limit(1);
      if (byRef) return byRef;
    }
    const mandateId = typeof d.mandate === "string" ? d.mandate : null;
    if (mandateId && typeof d.amount === "number") {
      const rows = await this.db
        .select({ a: debitAttempts })
        .from(debitAttempts)
        .innerJoin(debitMandates, eq(debitAttempts.mandateId, debitMandates.id))
        .where(
          and(
            eq(debitMandates.monoMandateId, mandateId),
            inArray(debitAttempts.status, ["initiated", "processing"]),
            eq(debitAttempts.amountKobo, BigInt(Math.round(d.amount))),
          ),
        )
        .limit(2);
      if (rows.length === 1) return rows[0].a;
    }
    return null;
  }

  // ── Settling an attempt ────────────────────────────────────────────────

  /**
   * Records what Mono said happened to one debit. Idempotent: a repeat of the
   * same outcome does nothing, and money is recorded against the installment
   * exactly once (the attempt row is locked, and `repayment_id` is unique).
   */
  async settle(attemptId: string, input: SettleInput): Promise<"recorded" | "failed" | "needs_review" | "noop"> {
    const now = new Date();
    const result = await this.db.transaction(async (tx: Tx) => {
      const [a] = await tx.select().from(debitAttempts).where(eq(debitAttempts.id, attemptId)).limit(1).for("update");
      if (!a) return { kind: "noop" as const };

      if (input.outcome === "failure") {
        // A failure can only close an attempt that's still open. One that already
        // succeeded, or was already closed, is left alone.
        if (a.status !== "initiated" && a.status !== "processing") return { kind: "noop" as const };
        await tx
          .update(debitAttempts)
          .set({
            status: "failed",
            responseCode: input.responseCode ?? a.responseCode,
            failureReason: failureExplanation(input.responseCode ?? null, input.message ?? null),
            providerReference: input.providerReference ?? a.providerReference,
            completedAt: now,
          })
          .where(eq(debitAttempts.id, a.id));
        return { kind: "failed" as const, attempt: a };
      }

      // Success. Already recorded → nothing to do. Otherwise record it — even if
      // we'd earlier written the attempt off as failed: money that moved must land.
      if (a.repaymentId) return { kind: "noop" as const };

      const [schedule] = await tx.select().from(repaymentSchedules).where(eq(repaymentSchedules.id, a.repaymentScheduleId)).limit(1).for("update");
      const owed = schedule ? schedule.amountKobo - schedule.amountPaidKobo : 0n;
      if (!schedule || schedule.isPaid || owed < a.amountKobo) {
        // The installment was settled another way while this debit was in flight.
        // The customer has been charged twice: don't touch the books, flag it.
        await tx
          .update(debitAttempts)
          .set({
            status: "needs_review",
            responseCode: input.responseCode ?? "00",
            failureReason: "collected after the installment was already paid — refund needed",
            feeKobo: input.feeKobo ?? a.feeKobo,
            providerReference: input.providerReference ?? a.providerReference,
            completedAt: now,
          })
          .where(eq(debitAttempts.id, a.id));
        return { kind: "needs_review" as const, attempt: a };
      }

      const receipt = await this.wallet.applyRepaymentTx(tx, a.repaymentScheduleId, a.amountKobo);
      await tx
        .update(debitAttempts)
        .set({
          status: "successful",
          responseCode: input.responseCode ?? "00",
          failureReason: null,
          feeKobo: input.feeKobo ?? a.feeKobo,
          providerReference: input.providerReference ?? a.providerReference,
          repaymentId: receipt.repaymentId,
          completedAt: now,
        })
        .where(eq(debitAttempts.id, a.id));
      // least(): the mandate's own CHECK forbids collecting past its cap, and a
      // rounding surprise must never turn a recorded repayment into a rollback.
      await tx
        .update(debitMandates)
        .set({ collectedKobo: sql`least(${debitMandates.collectedKobo} + ${a.amountKobo.toString()}::bigint, ${debitMandates.amountKobo})`, updatedAt: now })
        .where(eq(debitMandates.id, a.mandateId));
      return { kind: "recorded" as const, attempt: a, receipt };
    });

    if (result.kind === "recorded") {
      await this.wallet.sendReceipt(result.receipt);
      return "recorded";
    }
    if (result.kind === "failed") {
      await this.notifyFailed(result.attempt, input.outcome === "failure" ? input.responseCode ?? null : null, input.outcome === "failure" ? input.message ?? null : null);
      return "failed";
    }
    if (result.kind === "needs_review") {
      this.log.error(`attempt ${attemptId}: money collected but the installment was already paid — refund needed`);
      await this.notifyReview(result.attempt);
      return "needs_review";
    }
    return "noop";
  }

  private async notifyFailed(attempt: typeof debitAttempts.$inferSelect, code: string | null, message: string | null) {
    const [row] = await this.db
      .select({ fullName: users.fullName, email: users.email, n: repaymentSchedules.installmentNumber, total: repaymentSchedules.totalInstallments })
      .from(users)
      .innerJoin(repaymentSchedules, eq(repaymentSchedules.id, attempt.repaymentScheduleId))
      .where(eq(users.id, attempt.userId))
      .limit(1);
    if (!row?.email) return;
    const failedCount = (
      await this.db
        .select({ id: debitAttempts.id })
        .from(debitAttempts)
        .where(and(eq(debitAttempts.repaymentScheduleId, attempt.repaymentScheduleId), eq(debitAttempts.status, "failed")))
    ).length;
    void this.email.send({
      to: row.email,
      ...emails.autoDebitFailed(row.fullName ?? "there", {
        amount: naira(attempt.amountKobo),
        installmentNumber: row.n,
        totalInstallments: row.total,
        reason: failureExplanation(code, message),
        willRetry: failedCount < MAX_ATTEMPTS,
      }),
    });
  }

  private async notifyReview(attempt: typeof debitAttempts.$inferSelect) {
    const [u] = await this.db.select({ fullName: users.fullName, email: users.email }).from(users).where(eq(users.id, attempt.userId)).limit(1);
    if (u?.email) void this.email.send({ to: u.email, ...emails.autoDebitNeedsReview(u.fullName ?? "there", { amount: naira(attempt.amountKobo) }) });
  }

  // ── Collecting ──────────────────────────────────────────────────────────

  /**
   * One collection pass: take what's due, for customers with a live mandate,
   * once. Called by the scheduled job. Does nothing unless auto-debit is
   * switched on, and refuses to run a fake rail in production.
   */
  async collectDue(now: Date = new Date(), opts: { dryRun?: boolean } = {}): Promise<CollectSummary> {
    const summary: CollectSummary = { enabled: this.isEnabled(), blocked: false, candidates: 0, attempted: 0, skipped: {}, errors: 0, reconciled: 0 };
    if (!summary.enabled) return summary;
    if (!this.railIsSafe()) {
      summary.blocked = true;
      this.log.error("AUTO_DEBIT_ENABLED is on but no live Mono payments key is configured — refusing to run against the fake rail in production.");
      return summary;
    }

    summary.reconciled = opts.dryRun ? 0 : await this.reconcileStale(now);

    const rows = await this.db
      .select({
        scheduleId: repaymentSchedules.id,
        userId: repaymentSchedules.userId,
        dueDate: repaymentSchedules.dueDate,
        amountKobo: repaymentSchedules.amountKobo,
        paidKobo: repaymentSchedules.amountPaidKobo,
        installmentNumber: repaymentSchedules.installmentNumber,
        totalInstallments: repaymentSchedules.totalInstallments,
        mandate: debitMandates,
        employer: applicantProfiles.employer,
      })
      .from(repaymentSchedules)
      .innerJoin(debitMandates, and(eq(debitMandates.userId, repaymentSchedules.userId), eq(debitMandates.status, "active")))
      .leftJoin(applicantProfiles, eq(applicantProfiles.userId, repaymentSchedules.userId))
      .where(and(eq(repaymentSchedules.isPaid, false), lte(repaymentSchedules.dueDate, now)))
      .orderBy(repaymentSchedules.dueDate);
    summary.candidates = rows.length;
    if (rows.length === 0) return summary;

    const history = await this.db
      .select()
      .from(debitAttempts)
      .where(inArray(debitAttempts.repaymentScheduleId, rows.map((r) => r.scheduleId)));
    const byInstallment = new Map<string, AttemptHistory[]>();
    for (const h of history) {
      const list = byInstallment.get(h.repaymentScheduleId) ?? [];
      list.push({ status: h.status, responseCode: h.responseCode, createdAt: h.createdAt });
      byInstallment.set(h.repaymentScheduleId, list);
    }
    const totalAttempts = (id: string) => history.filter((h) => h.repaymentScheduleId === id).length;

    // One customer's installments are processed in order, and a mandate's cap is
    // tracked across them within this pass so two installments can't both claim
    // the same remaining room.
    const roomUsed = new Map<string, bigint>();
    for (let i = 0; i < rows.length; i += CONCURRENCY) {
      const batch = rows.slice(i, i + CONCURRENCY);
      // Same-mandate rows in one batch would race for the cap; run those sequentially.
      const seen = new Set<string>();
      const parallel = batch.filter((r) => (seen.has(r.mandate.id) ? false : (seen.add(r.mandate.id), true)));
      const rest = batch.filter((r) => !parallel.includes(r));
      const run = async (r: (typeof rows)[number]) => {
        const used = roomUsed.get(r.mandate.id) ?? 0n;
        const decision = decideDebit({
          now,
          dueDate: r.dueDate,
          remainingKobo: r.amountKobo - r.paidKobo,
          mandate: { status: r.mandate.status, amountKobo: r.mandate.amountKobo, collectedKobo: r.mandate.collectedKobo + used },
          attempts: byInstallment.get(r.scheduleId) ?? [],
          employer: r.employer,
        });
        if (!decision.debit) {
          summary.skipped[decision.reason] = (summary.skipped[decision.reason] ?? 0) + 1;
          return;
        }
        if (opts.dryRun) {
          summary.attempted += 1;
          return;
        }
        roomUsed.set(r.mandate.id, used + decision.amountKobo);
        try {
          const outcome = await this.attemptDebit(r, decision, totalAttempts(r.scheduleId) + 1, "scheduled", now);
          if (outcome === "raced") summary.skipped.in_flight = (summary.skipped.in_flight ?? 0) + 1;
          else summary.attempted += 1;
        } catch (e) {
          summary.errors += 1;
          this.log.error(`debit for installment ${r.scheduleId} errored: ${short(e)}`);
        }
      };
      await Promise.all(parallel.map(run));
      for (const r of rest) await run(r);
    }

    this.log.log(`collection pass: ${summary.candidates} due, ${summary.attempted} debited, ${summary.errors} errored, skipped ${JSON.stringify(summary.skipped)}`);
    return summary;
  }

  private async attemptDebit(
    r: { scheduleId: string; userId: string; installmentNumber: number; totalInstallments: number; mandate: typeof debitMandates.$inferSelect },
    decision: DebitDecision,
    attemptNumber: number,
    trigger: "scheduled" | "manual",
    now: Date,
  ): Promise<"sent" | "raced"> {
    if (!r.mandate.monoMandateId) throw new Error("active mandate has no Mono mandate id");

    const id = randomUUID();
    const reference = `fm-dd-${id}`;
    // Written *before* anything is sent. The unique "one open attempt per
    // installment" index is what makes a concurrent second pass lose here.
    try {
      await this.db.insert(debitAttempts).values({
        id,
        repaymentScheduleId: r.scheduleId,
        mandateId: r.mandate.id,
        userId: r.userId,
        attemptNumber,
        reference,
        amountKobo: decision.amountKobo,
        status: "initiated",
        trigger,
      });
    } catch (e) {
      if (errCode(e) === "23505") return "raced";
      throw e;
    }

    // From here the request may reach Mono, so a crash is reviewed, not retried.
    await this.db.update(debitAttempts).set({ sentAt: now }).where(eq(debitAttempts.id, id));

    let result;
    try {
      result = await this.client.debit(r.mandate.monoMandateId, {
        amountKobo: Number(decision.amountKobo),
        reference,
        narration: `Farmer Market installment ${r.installmentNumber}/${r.totalInstallments}`,
      });
    } catch (e) {
      if (e instanceof DebitRateLimitedError) {
        // Mono refused before doing anything. Wait a day; don't count it as a failed attempt.
        await this.db
          .update(debitAttempts)
          .set({ status: "failed", responseCode: NOT_COUNTED_CODE, failureReason: "Mono rate-limited debits for this account today", completedAt: new Date() })
          .where(eq(debitAttempts.id, id));
        return "sent";
      }
      // A timeout or network error: we can't know whether Mono took it.
      await this.db
        .update(debitAttempts)
        .set({ status: "needs_review", failureReason: `no answer from Mono (${short(e)})`, completedAt: new Date() })
        .where(eq(debitAttempts.id, id));
      this.log.error(`debit ${reference}: no answer from Mono — left for review, will not retry`);
      return "sent";
    }

    if (result.outcome === "successful") {
      await this.settle(id, { outcome: "success", responseCode: result.responseCode, feeKobo: result.feeKobo == null ? null : BigInt(result.feeKobo), providerReference: result.providerReference });
    } else if (result.outcome === "failed") {
      await this.settle(id, { outcome: "failure", responseCode: result.responseCode, message: result.message, providerReference: result.providerReference });
    } else {
      await this.db
        .update(debitAttempts)
        .set({ status: "processing", responseCode: result.responseCode, providerReference: result.providerReference })
        .where(and(eq(debitAttempts.id, id), eq(debitAttempts.status, "initiated")));
    }
    return "sent";
  }

  /** Closes attempts that will otherwise sit open forever, blocking the installment. Returns how many it moved. */
  async reconcileStale(now: Date): Promise<number> {
    let n = 0;
    // Never sent (the process died between writing the attempt and sending it): safe to drop.
    const unsent = await this.db
      .update(debitAttempts)
      .set({ status: "failed", responseCode: NOT_COUNTED_CODE, failureReason: "the request was never sent", completedAt: now })
      .where(and(eq(debitAttempts.status, "initiated"), sql`${debitAttempts.sentAt} is null`, lt(debitAttempts.createdAt, new Date(now.getTime() - UNSENT_ATTEMPT_MS))))
      .returning({ id: debitAttempts.id });
    n += unsent.length;
    // Sent but never answered: may have moved money — a person looks.
    const unanswered = await this.db
      .update(debitAttempts)
      .set({ status: "needs_review", failureReason: "sent to Mono but no answer was recorded", completedAt: now })
      .where(and(eq(debitAttempts.status, "initiated"), sql`${debitAttempts.sentAt} is not null`, lt(debitAttempts.sentAt, new Date(now.getTime() - UNANSWERED_ATTEMPT_MS))))
      .returning({ id: debitAttempts.id });
    n += unanswered.length;
    const stuck = await this.db
      .update(debitAttempts)
      .set({ status: "needs_review", failureReason: "still processing long after Mono's retry window — check with Mono", completedAt: now })
      .where(and(eq(debitAttempts.status, "processing"), lt(debitAttempts.sentAt, new Date(now.getTime() - PROCESSING_TIMEOUT_MS))))
      .returning({ id: debitAttempts.id });
    n += stuck.length;
    return n;
  }

  /** A person has dealt with an attempt in `needs_review` (refunded it, or confirmed it never happened); unblocks the installment. */
  async resolveReview(attemptId: string, staffId: string, note: string) {
    const [a] = await this.db.select().from(debitAttempts).where(eq(debitAttempts.id, attemptId)).limit(1);
    if (!a) throw new NotFoundException("Debit attempt not found");
    if (a.status !== "needs_review") throw new BadRequestException("This attempt isn't waiting for review.");
    await this.db
      .update(debitAttempts)
      .set({ status: "failed", responseCode: NOT_COUNTED_CODE, failureReason: `resolved by staff: ${note}` })
      .where(eq(debitAttempts.id, attemptId));
    await this.db.insert(auditLogs).values({
      actorStaffId: staffId,
      action: "customer.auto_debit_review_resolved",
      targetType: "user",
      targetId: a.userId,
      metadata: { attemptId, note },
    });
  }
}
