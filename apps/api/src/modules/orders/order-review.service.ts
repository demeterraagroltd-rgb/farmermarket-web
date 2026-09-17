import { Inject, Injectable } from "@nestjs/common";
import { desc, eq } from "drizzle-orm";
import { applications, type Db } from "@farmermarket/db";
import { DB } from "../../db/db.module";
import { KycService } from "../kyc/kyc.service";
import { WalletService } from "../wallet/wallet.service";
import { OrdersService } from "./orders.service";

// An application still moving through the (separate, parallel) origination
// pipeline — the counterpart of "one open application per user" in
// packages/db/src/schema/origination.ts's partial unique index, minus
// limit_active (that one's a resolved outcome, not something pending).
const OPEN_APPLICATION_STATUSES = [
  "draft", "submitted", "auto_checks", "info_required", "credit_review", "escalated",
  "offer_issued", "offer_accepted",
];

/**
 * Composes the Order Review / credit-underwriting workspace: one order,
 * joined with everything already tracked about the buyer — KYC/BVN
 * verification, Mono bank analysis, credit position, repayment history,
 * other orders, and any origination application. Nothing here is a new data
 * source; every field already exists behind {@link OrdersService},
 * {@link KycService}, or {@link WalletService} — this only assembles them and
 * computes the readiness gate the Decision panel enforces.
 */
@Injectable()
export class OrderReviewService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly orders: OrdersService,
    private readonly kyc: KycService,
    private readonly wallet: WalletService,
  ) {}

  async getReview(staffId: string, orderId: string) {
    const order = await this.orders.findOneForStaff(orderId);
    const userId = order.userId;

    const [applicant, creditPosition, otherOrders, applicationRows] = await Promise.all([
      this.kyc.getForStaff(staffId, userId),
      this.wallet.getCreditPositionForStaff(userId),
      this.orders.findAllForUser(userId),
      this.db
        .select()
        .from(applications)
        .where(eq(applications.userId, userId))
        .orderBy(desc(applications.createdAt)),
    ]);

    const orderHistory = otherOrders.filter((o) => o.id !== order.id);
    const otherPendingOrders = orderHistory.filter((o) => o.status === "pending_approval");
    const pendingApplication = applicationRows.find((a) => OPEN_APPLICATION_STATUSES.includes(a.status));

    const repaymentPreview =
      order.status === "pending_approval" && order.bnplPlan
        ? this.orders.previewInstallments(order.totalKobo, order.bnplPlan)
        : null;

    const profile = applicant.profile as Record<string, unknown> & { verificationStatus: string };
    const kycVerified = profile.verificationStatus === "verified";
    const identityChecked = profile.identityLookup != null;
    const bankLinked = profile.bankLinkedAt != null;
    const hasOverdueRepayments = creditPosition.overdueCount > 0;

    const blockers: string[] = [];
    if (!kycVerified) blockers.push("Applicant KYC is not verified — verification is required before approval.");

    const warnings: string[] = [];
    if (hasOverdueRepayments) {
      warnings.push(
        `${creditPosition.overdueCount} overdue repayment${creditPosition.overdueCount === 1 ? "" : "s"} on this customer's account.`,
      );
    }
    if (otherPendingOrders.length > 0) {
      warnings.push(`${otherPendingOrders.length} other order(s) already awaiting approval for this customer.`);
    }
    if (pendingApplication) {
      warnings.push(`An origination application (${pendingApplication.reference}) is still in progress for this customer.`);
    }
    if (!identityChecked) {
      warnings.push("No BVN/NIN identity lookup has been run against a government record yet.");
    }
    if (!bankLinked) {
      warnings.push("No bank account has been linked via Mono — repayment capacity can't be independently checked.");
    }

    return {
      order,
      applicant,
      creditPosition,
      orderHistory,
      applications: applicationRows,
      repaymentPreview,
      readiness: {
        kycVerified,
        identityChecked,
        bankLinked,
        hasOverdueRepayments,
        hasOtherPendingOrders: otherPendingOrders.length > 0,
        hasPendingApplication: !!pendingApplication,
        blockers,
        warnings,
      },
    };
  }
}
