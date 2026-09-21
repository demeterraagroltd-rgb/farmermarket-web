import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { and, desc, eq, inArray } from "drizzle-orm";
import { koboToNaira } from "@farmermarket/core";
import {
  applicationDecisions,
  applications,
  auditLogs,
  repaymentSchedules,
  repayments,
  staff,
  users,
  type Db,
} from "@farmermarket/db";
import { DB } from "../../db/db.module";
import { KycService } from "../kyc/kyc.service";
import { WalletService } from "../wallet/wallet.service";
import { OrdersService } from "../orders/orders.service";
import type { BankAnalysis } from "../kyc/bank-analysis";
import type { IdentityCheck } from "../kyc/identity-match";
import {
  bankConnectionState,
  compareIncome,
  employmentState,
  freshnessOf,
  identityStatuses,
  lastFinancialSync,
  maskTail,
  summariseRepayments,
} from "./customer-360";

const toNumber = (v: unknown): number | null => {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * Composes the Customer 360 page: everything already tracked about one
 * customer, in one read. Like OrderReviewService it introduces no data source
 * of its own — every field comes from {@link KycService}, {@link WalletService},
 * {@link OrdersService} or a plain table read — so the screens can't drift into
 * disagreeing about the same customer.
 *
 * Opening the page never calls Mono. Bank and income figures come from what was
 * stored when the account was linked or last refreshed; the only way to reach
 * Mono from here is the explicit refresh action.
 */
@Injectable()
export class Customer360Service {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly kyc: KycService,
    private readonly wallet: WalletService,
    private readonly orders: OrdersService,
  ) {}

  async getDetail(staffId: string, customerId: string) {
    const [user] = await this.db.select().from(users).where(eq(users.id, customerId)).limit(1);
    if (!user) throw new NotFoundException("Customer not found");

    const [kycView, creditPosition, orderList, applicationRows, paymentRows, auditRows] = await Promise.all([
      // A customer created before KYC existed has a users row but no profile —
      // that is a legitimate (empty) state for this page, not a 404.
      this.kyc.getForStaff(staffId, customerId, { audit: false }).catch((e: unknown) => {
        if (e instanceof NotFoundException) return null;
        throw e;
      }),
      this.wallet.getCreditPositionForStaff(customerId),
      this.orders.findAllForUser(customerId),
      this.db.select().from(applications).where(eq(applications.userId, customerId)).orderBy(desc(applications.createdAt)),
      this.db
        .select({
          id: repayments.id,
          amountKobo: repayments.amountKobo,
          paidAt: repayments.paidAt,
          orderId: repaymentSchedules.orderId,
          installmentNumber: repaymentSchedules.installmentNumber,
          totalInstallments: repaymentSchedules.totalInstallments,
        })
        .from(repayments)
        .innerJoin(repaymentSchedules, eq(repayments.repaymentScheduleId, repaymentSchedules.id))
        .where(eq(repaymentSchedules.userId, customerId))
        .orderBy(desc(repayments.paidAt))
        .limit(200),
      this.db
        .select({
          id: auditLogs.id,
          action: auditLogs.action,
          metadata: auditLogs.metadata,
          createdAt: auditLogs.createdAt,
          staffName: staff.fullName,
          staffEmail: staff.email,
        })
        .from(auditLogs)
        .leftJoin(staff, eq(auditLogs.actorStaffId, staff.id))
        .where(and(eq(auditLogs.targetType, "user"), eq(auditLogs.targetId, customerId)))
        .orderBy(desc(auditLogs.createdAt))
        .limit(200),
    ]);

    // Decisions for the applications above, newest first, so the latest wins
    // when an application was decided more than once.
    const appIds = applicationRows.map((a) => a.id);
    const decisionRows = appIds.length
      ? await this.db
          .select({
            applicationId: applicationDecisions.applicationId,
            outcome: applicationDecisions.outcome,
            approvedLimitKobo: applicationDecisions.approvedLimitKobo,
            tier: applicationDecisions.tier,
            reasonCodes: applicationDecisions.reasonCodes,
            notes: applicationDecisions.notes,
            decidedAt: applicationDecisions.createdAt,
            decidedByName: staff.fullName,
          })
          .from(applicationDecisions)
          .leftJoin(staff, eq(applicationDecisions.decidedBy, staff.id))
          .where(inArray(applicationDecisions.applicationId, appIds))
          .orderBy(desc(applicationDecisions.createdAt))
      : [];
    const latestDecision = new Map<string, (typeof decisionRows)[number]>();
    for (const d of decisionRows) if (!latestDecision.has(d.applicationId)) latestDecision.set(d.applicationId, d);

    const profile = (kycView?.profile ?? null) as Record<string, any> | null;
    const analysis = (profile?.bankAnalysis ?? null) as BankAnalysis | null;
    const identityLookup = (profile?.identityLookup ?? null) as IdentityCheck | null;

    // ── identity ──────────────────────────────────────────────────────────
    const identity = identityStatuses({
      hasBvn: !!profile?.hasBvn,
      hasNin: !!profile?.nin,
      identityLookup,
    });

    // ── bank / financial ──────────────────────────────────────────────────
    const monoAccountId: string | null = profile?.monoAccountId ?? null;
    const bankState = bankConnectionState({
      monoAccountId,
      bankLinkRequestedAt: profile?.bankLinkRequestedAt,
    });
    const syncAt = lastFinancialSync({ bankAnalysis: analysis, bankLinkedAt: profile?.bankLinkedAt });
    const freshness = freshnessOf(syncAt);
    const declaredKobo = toNumber(profile?.netMonthlySalaryKobo);
    const estimatedKobo = analysis?.estimatedMonthlyIncomeKobo ?? null;

    const accounts = monoAccountId
      ? [
          {
            monoAccountId,
            bankName: profile?.bankName ?? analysis?.institution ?? null,
            accountName: analysis?.accountName ?? null,
            accountMasked: profile?.accountLast4 ? `•••• ${profile.accountLast4}` : null,
            currency: "NGN",
            balanceKobo: analysis?.balanceKobo ?? null,
            // We don't yet receive Mono's disconnect events, so "connected" means
            // "we hold an account id and haven't been told otherwise".
            status: "connected" as const,
            linkedAt: profile?.bankLinkedAt ?? null,
            lastSyncAt: syncAt,
            freshness,
          },
        ]
      : [];

    // ── repayments ────────────────────────────────────────────────────────
    const scheduleSummary = summariseRepayments(creditPosition.schedules);
    const ordersOut = orderList.map((o) => {
      const own = creditPosition.schedules.filter((s) => s.orderId === o.id);
      const summary = summariseRepayments(own);
      return {
        ...o,
        planName: own[0]?.bnplPlanName ?? null,
        repaymentStatus: summary.collectionStatus,
        repaid: summary.totalRepaid,
        outstanding: summary.outstanding,
      };
    });

    await this.db.insert(auditLogs).values({
      actorStaffId: staffId,
      action: "customer.viewed",
      targetType: "user",
      targetId: customerId,
    });

    const registeredAt = user.createdAt;
    const lastUpdated = [user.updatedAt, profile?.updatedAt]
      .filter(Boolean)
      .map((d) => new Date(d as string | Date).getTime())
      .reduce((a, b) => Math.max(a, b), 0);

    return {
      customer: {
        id: user.id,
        fullName: user.fullName ?? profile?.fullName ?? null,
        phone: user.phone,
        email: user.email ?? profile?.email ?? null,
        registeredAt,
        phoneVerifiedAt: user.phoneVerifiedAt,
        lastUpdatedAt: new Date(lastUpdated || registeredAt).toISOString(),
        accountStatus: user.deactivatedAt ? ("suspended" as const) : ("active" as const),
        suspendedAt: user.deactivatedAt,
        suspendedReason: user.deactivatedReason,
      },

      summary: {
        kycStatus: (profile?.verificationStatus as string | undefined) ?? "unverified",
        bankState,
        estimatedMonthlyIncomeKobo: estimatedKobo,
        incomeRegularity: analysis?.salaryRegularity ?? null,
        bankBalanceKobo: analysis?.balanceKobo ?? null,
        lastSyncAt: syncAt,
        freshness,
      },

      // What the customer told us — kept apart from `identity` below, which is
      // what a government record said about them.
      declared: profile
        ? {
            fullName: profile.fullName ?? null,
            phone: profile.phone ?? user.phone,
            email: profile.email ?? null,
            dateOfBirth: profile.dateOfBirth ?? null,
            gender: profile.gender ?? null,
            maritalStatus: profile.maritalStatus ?? null,
            dependantsCount: profile.dependantsCount ?? null,
            address: profile.residentialAddress ?? null,
            state: profile.residentialAddress?.state ?? null,
            lga: profile.residentialAddress?.lga ?? null,
            stateOfOrigin: profile.stateOfOrigin ?? null,
            lgaOfOrigin: profile.lgaOfOrigin ?? null,
            nextOfKin: profile.nextOfKin ?? null,
            employmentType: profile.employmentType ?? null,
            employer: profile.employer ?? null,
            jobTitle: profile.jobTitle ?? null,
            declaredMonthlyIncomeKobo: declaredKobo,
            salaryDay: profile.salaryDay ?? null,
            yearsEmployed: profile.yearsEmployed ?? null,
            requestedLimitKobo: toNumber(profile.requestedLimitKobo),
            employmentState: employmentState({
              employmentType: profile.employmentType,
              employer: profile.employer,
              jobTitle: profile.jobTitle,
              netMonthlySalaryKobo: profile.netMonthlySalaryKobo,
            }),
          }
        : null,

      identity: {
        // Identifiers are masked: an admin needs to know which BVN/NIN, not read it.
        bvnMasked: profile?.bvnLast4 ? `•••••••${profile.bvnLast4}` : null,
        ninMasked: maskTail(profile?.nin),
        bvn: identity.bvn,
        nin: identity.nin,
        mashup: identity.mashup,
        latestCheck: identityLookup,
        // Only the reviewer-facing fact that the no-consent check can run.
        bvnMashupAvailable: !!profile?.bvnMashupAvailable,
        verification: profile
          ? {
              status: profile.verificationStatus,
              note: profile.verificationNote ?? null,
              submittedAt: profile.submittedAt ?? null,
              verifiedAt: profile.verifiedAt ?? null,
            }
          : null,
        documents: kycView?.documents ?? [],
        events: kycView?.events ?? [],
      },

      bank: {
        state: bankState,
        requestedAt: profile?.bankLinkRequestedAt ?? null,
        accounts,
      },

      financial: {
        analysis,
        salaryDetected: analysis?.salaryDetected ?? null,
        income: compareIncome(declaredKobo, estimatedKobo),
        employerMatch: analysis?.employerNameMatch ?? null,
        regularity: analysis?.salaryRegularity ?? null,
        confidence: analysis?.incomeConfidence ?? null,
        monthsAnalysed: analysis?.monthsAnalysed ?? 0,
        source: analysis?.source ?? null,
        retrievedAt: analysis?.pulledAt ?? null,
        freshness: freshnessOf(analysis?.pulledAt ?? null),
      },

      credit: creditPosition.profile,
      repayments: {
        summary: scheduleSummary,
        schedules: creditPosition.schedules,
        history: paymentRows.map((p) => ({
          id: p.id,
          amount: koboToNaira(p.amountKobo),
          paidAt: p.paidAt,
          orderId: p.orderId,
          installmentNumber: p.installmentNumber,
          totalInstallments: p.totalInstallments,
        })),
      },
      orders: ordersOut,

      applications: applicationRows.map((a) => {
        const d = latestDecision.get(a.id);
        return {
          id: a.id,
          reference: a.reference,
          status: a.status,
          channel: a.channel,
          requestedLimitKobo: toNumber(a.requestedLimitKobo),
          submittedAt: a.submittedAt,
          createdAt: a.createdAt,
          decision: d
            ? {
                outcome: d.outcome,
                approvedLimitKobo: toNumber(d.approvedLimitKobo),
                tier: d.tier,
                reasonCodes: d.reasonCodes,
                notes: d.notes,
                decidedAt: d.decidedAt,
                decidedBy: d.decidedByName,
              }
            : null,
        };
      }),

      audit: auditRows.map((r) => ({
        id: r.id,
        action: r.action,
        at: r.createdAt,
        staff: r.staffName ? { name: r.staffName, email: r.staffEmail } : null,
        metadata: r.metadata ?? null,
      })),
    };
  }
}
