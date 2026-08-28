import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { desc, eq } from "drizzle-orm";
import { koboToNaira, nairaToKobo } from "@farmermarket/core";
import {
  creditProfiles,
  orders,
  repaymentSchedules,
  repayments,
  bnplPlans,
  users,
  type Db,
} from "@farmermarket/db";
import { DB } from "../../db/db.module";
import { LedgerService } from "../ledger/ledger.service";
import { AuthService } from "../auth/auth.service";
import type { PayRepaymentInput } from "./dto/pay-repayment.dto";

@Injectable()
export class WalletService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly ledger: LedgerService,
    private readonly authService: AuthService,
  ) {}

  // GET /v1/credit/profile — the first customer-facing read of the row
  // ApplicationsService.decide() already writes on approval (§14's next
  // piece, per WalletRepository's own TODO comment).
  async getCreditProfile(userId: string) {
    const [profile] = await this.db.select().from(creditProfiles).where(eq(creditProfiles.userId, userId)).limit(1);

    const totalLimitKobo = profile?.creditLimitKobo ?? 0n;
    const usedKobo = profile?.usedCreditKobo ?? 0n;

    const userOrders = await this.db.select({ id: orders.id }).from(orders).where(eq(orders.userId, userId));
    const userRepayments = await this.db
      .select({
        amountKobo: repayments.amountKobo,
        paidAt: repayments.paidAt,
        dueDate: repaymentSchedules.dueDate,
      })
      .from(repayments)
      .innerJoin(repaymentSchedules, eq(repayments.repaymentScheduleId, repaymentSchedules.id))
      .where(eq(repaymentSchedules.userId, userId));

    const onTime = userRepayments.filter((r) => r.paidAt <= r.dueDate).length;

    return {
      totalLimit: koboToNaira(totalLimitKobo),
      usedAmount: koboToNaira(usedKobo),
      availableAmount: koboToNaira(totalLimitKobo - usedKobo),
      // 300-850 scale (§8) — a profile awaiting its first scorecard run has
      // no score yet; the mid-point is a neutral placeholder, not a claim
      // about creditworthiness. The Dart `CreditInfo.creditScore` is
      // non-nullable, so returning null isn't an option here.
      creditScore: profile?.score ?? 575,
      tier: profile?.tier ?? "None",
      totalOrders: userOrders.length,
      onTimeRepayments: onTime,
      repaymentRate: userRepayments.length > 0 ? onTime / userRepayments.length : 1,
    };
  }

  // GET /v1/wallet/transactions — a display-only derivation from orders +
  // repayments, both already user-scoped. The plan's "transactions become
  // a view over the ledger" (§5.4) is the accounting-grade version of this;
  // this is the pragmatic scope for Phase 4's first pass — same facts,
  // simpler query, no join through ledger_entries' system accounts needed.
  async getTransactions(userId: string) {
    const userOrders = await this.db
      .select({ id: orders.id, totalKobo: orders.totalKobo, placedAt: orders.placedAt })
      .from(orders)
      .where(eq(orders.userId, userId));

    const userRepayments = await this.db
      .select({
        id: repayments.id,
        amountKobo: repayments.amountKobo,
        paidAt: repayments.paidAt,
        orderId: repaymentSchedules.orderId,
      })
      .from(repayments)
      .innerJoin(repaymentSchedules, eq(repayments.repaymentScheduleId, repaymentSchedules.id))
      .where(eq(repaymentSchedules.userId, userId));

    const purchaseTxns = userOrders.map((o) => ({
      id: `order-${o.id}`,
      type: "purchase" as const,
      amount: koboToNaira(o.totalKobo),
      description: "Order placed",
      referenceId: o.id,
      createdAt: o.placedAt,
      isCredit: false,
    }));

    const repaymentTxns = userRepayments.map((r) => ({
      id: `repayment-${r.id}`,
      type: "repayment" as const,
      amount: koboToNaira(r.amountKobo),
      description: "Repayment",
      referenceId: r.orderId,
      createdAt: r.paidAt,
      isCredit: true,
    }));

    return [...purchaseTxns, ...repaymentTxns].sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
    );
  }

  // GET /v1/wallet/repayments
  async getRepaymentSchedules(userId: string) {
    const rows = await this.db
      .select({
        id: repaymentSchedules.id,
        orderId: repaymentSchedules.orderId,
        amountKobo: repaymentSchedules.amountKobo,
        amountPaidKobo: repaymentSchedules.amountPaidKobo,
        dueDate: repaymentSchedules.dueDate,
        isPaid: repaymentSchedules.isPaid,
        installmentNumber: repaymentSchedules.installmentNumber,
        totalInstallments: repaymentSchedules.totalInstallments,
        bnplPlanName: bnplPlans.name,
      })
      .from(repaymentSchedules)
      .innerJoin(orders, eq(repaymentSchedules.orderId, orders.id))
      .innerJoin(bnplPlans, eq(orders.bnplPlanId, bnplPlans.id))
      .where(eq(repaymentSchedules.userId, userId))
      .orderBy(repaymentSchedules.dueDate);

    const now = new Date();
    return rows.map((r) => ({
      id: r.id,
      orderId: r.orderId,
      // "restaurantName" is a legacy field name from the app's original
      // food-delivery scaffold — Farmer Market is a single-seller catalog
      // today (plan §17 open item #11, undecided), so there's no per-order
      // merchant name to put here yet.
      restaurantName: "Farmer Market",
      amount: koboToNaira(r.amountKobo),
      amountPaid: koboToNaira(r.amountPaidKobo),
      dueDate: r.dueDate,
      isPaid: r.isPaid,
      isOverdue: !r.isPaid && r.dueDate < now,
      installmentNumber: r.installmentNumber,
      totalInstallments: r.totalInstallments,
      bnplPlanName: r.bnplPlanName,
    }));
  }

  // POST /v1/wallet/repayments/:id/pay
  //
  // No real payment rail is wired up (Paystack/Flutterwave are "anticipated
  // later", §9.3) — this records that a repayment happened and moves the
  // money in the ledger, the same "record what happened, wire the real rail
  // in later" pattern as the rest of Phase 4.
  async payRepayment(userId: string, scheduleId: string, input: PayRepaymentInput) {
    await this.authService.assertTxnPin(userId, input.txnPin);
    return this._recordRepayment(scheduleId, input.amountNaira, userId);
  }

  // Staff-initiated equivalent (dashboard collections) — same money movement,
  // any customer's schedule, no caller-scope check.
  async recordRepayment(scheduleId: string, amountNaira: number) {
    return this._recordRepayment(scheduleId, amountNaira, undefined);
  }

  private async _recordRepayment(scheduleId: string, amountNaira: number, expectedUserId?: string) {
    return this.db.transaction(async (tx) => {
      const [schedule] = await tx
        .select()
        .from(repaymentSchedules)
        .where(eq(repaymentSchedules.id, scheduleId))
        .limit(1);
      if (!schedule || (expectedUserId && schedule.userId !== expectedUserId)) {
        throw new NotFoundException("Repayment schedule not found");
      }
      if (schedule.isPaid) throw new BadRequestException("This installment is already paid");
      const userId = schedule.userId;

      const amountKobo = nairaToKobo(amountNaira);
      const newPaidKobo = schedule.amountPaidKobo + amountKobo;
      if (newPaidKobo > schedule.amountKobo) {
        throw new BadRequestException("Amount exceeds what's owed on this installment");
      }

      const [repayment] = await tx
        .insert(repayments)
        .values({ repaymentScheduleId: scheduleId, amountKobo })
        .returning();

      await tx
        .update(repaymentSchedules)
        .set({ amountPaidKobo: newPaidKobo, isPaid: newPaidKobo === schedule.amountKobo })
        .where(eq(repaymentSchedules.id, scheduleId));

      const [profile] = await tx.select().from(creditProfiles).where(eq(creditProfiles.userId, userId)).limit(1);
      const usedKobo = profile?.usedCreditKobo ?? 0n;
      // used_credit_kobo has a CHECK (>= 0) — a repayment can't push it
      // negative, but floor here too rather than letting the DB constraint
      // be the only thing standing between a bug and a 500.
      const newUsedKobo = usedKobo - amountKobo < 0n ? 0n : usedKobo - amountKobo;

      await tx
        .update(creditProfiles)
        .set({ usedCreditKobo: newUsedKobo, updatedAt: new Date() })
        .where(eq(creditProfiles.userId, userId));

      // A repayment reverses part of the receivable: cash comes in, the
      // amount owed goes down. Same two accounts as order placement,
      // opposite direction.
      await this.ledger.post(tx, repayment.id, [
        { accountName: "Cash", accountType: "asset", direction: "D", amountKobo, repaymentId: repayment.id },
        { accountName: "Loans Receivable", accountType: "asset", direction: "C", amountKobo, repaymentId: repayment.id },
      ]);

      return { success: true };
    });
  }

  // ── Staff / dashboard: collections ───────────────────────────────────────

  async listAllRepayments() {
    const rows = await this.db
      .select({
        id: repaymentSchedules.id,
        orderId: repaymentSchedules.orderId,
        userId: repaymentSchedules.userId,
        buyerName: users.fullName,
        buyerPhone: users.phone,
        amountKobo: repaymentSchedules.amountKobo,
        amountPaidKobo: repaymentSchedules.amountPaidKobo,
        dueDate: repaymentSchedules.dueDate,
        isPaid: repaymentSchedules.isPaid,
        installmentNumber: repaymentSchedules.installmentNumber,
        totalInstallments: repaymentSchedules.totalInstallments,
        bnplPlanName: bnplPlans.name,
      })
      .from(repaymentSchedules)
      .innerJoin(orders, eq(repaymentSchedules.orderId, orders.id))
      .innerJoin(bnplPlans, eq(orders.bnplPlanId, bnplPlans.id))
      .leftJoin(users, eq(repaymentSchedules.userId, users.id))
      .orderBy(repaymentSchedules.dueDate);

    const now = new Date();
    return rows.map((r) => {
      const daysPastDue = r.isPaid ? 0 : Math.max(0, Math.floor((now.getTime() - r.dueDate.getTime()) / 86_400_000));
      const bucket = r.isPaid
        ? "paid"
        : daysPastDue === 0
          ? "current"
          : daysPastDue <= 30
            ? "1-30"
            : daysPastDue <= 60
              ? "31-60"
              : "60+";
      return {
        id: r.id,
        orderId: r.orderId,
        buyerName: r.buyerName ?? null,
        buyerPhone: r.buyerPhone ?? null,
        amount: koboToNaira(r.amountKobo),
        amountPaid: koboToNaira(r.amountPaidKobo),
        amountDue: koboToNaira(r.amountKobo - r.amountPaidKobo),
        dueDate: r.dueDate,
        isPaid: r.isPaid,
        isOverdue: !r.isPaid && r.dueDate < now,
        daysPastDue,
        bucket,
        installmentNumber: r.installmentNumber,
        totalInstallments: r.totalInstallments,
        bnplPlanName: r.bnplPlanName,
      };
    });
  }
}
