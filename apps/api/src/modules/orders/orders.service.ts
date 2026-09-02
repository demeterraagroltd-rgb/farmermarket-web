import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { and, desc, eq, inArray } from "drizzle-orm";
import { koboToNaira, percentOfKobo } from "@farmermarket/core";
import {
  orders,
  orderItems,
  products,
  bnplPlans,
  creditProfiles,
  creditLimitChanges,
  repaymentSchedules,
  users,
  type Db,
  type Tx,
} from "@farmermarket/db";
import { DB } from "../../db/db.module";
import { LedgerService } from "../ledger/ledger.service";
import { AuthService } from "../auth/auth.service";
import { KycService } from "../kyc/kyc.service";
import { EmailService } from "../notifications/email.service";
import { emails } from "../notifications/templates";
import type { CreateOrderInput } from "./dto/create-order.dto";

// Hardcoded to match the Flutter app's `Cart` fees exactly (§5.7) — both
// sides need to move onto the `config` table's `fees` key together so a fee
// change is one dashboard edit, not two code changes. Out of scope here.
const DELIVERY_FEE_KOBO = 50_000n; // ₦500
const SERVICE_FEE_PERCENT = 3;

const DAY_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class OrdersService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly ledger: LedgerService,
    private readonly authService: AuthService,
    private readonly kyc: KycService,
    private readonly email: EmailService,
  ) {}

  private async notifyBuyer(userId: string, build: (name: string, email: string | null) => { subject: string; html: string }) {
    const [u] = await this.db
      .select({ fullName: users.fullName, email: users.email })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!u) return;
    void this.email.send({ to: u.email, ...build(u.fullName ?? "there", u.email) });
  }

  async findAllForUser(userId: string) {
    const rows = await this.db.select().from(orders).where(eq(orders.userId, userId)).orderBy(desc(orders.placedAt));
    return Promise.all(rows.map((o) => this.attachItems(o)));
  }

  async findOneForUser(userId: string, orderId: string) {
    const [order] = await this.db
      .select()
      .from(orders)
      .where(and(eq(orders.id, orderId), eq(orders.userId, userId)))
      .limit(1);
    if (!order) throw new NotFoundException("Order not found");
    return this.attachItems(order);
  }

  private async attachItems(order: typeof orders.$inferSelect) {
    const items = await this.db.select().from(orderItems).where(eq(orderItems.orderId, order.id));
    return this.toResponse(order, items);
  }

  // ── Staff / dashboard ────────────────────────────────────────────────────

  async findAllForStaff() {
    const rows = await this.db
      .select({
        order: orders,
        buyerName: users.fullName,
        buyerPhone: users.phone,
        planName: bnplPlans.name,
      })
      .from(orders)
      .leftJoin(users, eq(orders.userId, users.id))
      .leftJoin(bnplPlans, eq(orders.bnplPlanId, bnplPlans.id))
      .orderBy(desc(orders.placedAt));

    return Promise.all(
      rows.map(async ({ order, buyerName, buyerPhone, planName }) => {
        const items = await this.db.select().from(orderItems).where(eq(orderItems.orderId, order.id));
        return {
          ...this.toResponse(order, items),
          buyerName: buyerName ?? null,
          buyerPhone: buyerPhone ?? null,
          bnplPlanName: planName ?? null,
        };
      }),
    );
  }

  // Post-approval lifecycle only (preparing → on_the_way → delivered,
  // cancelled). Entering `confirmed`/`rejected` goes through approve()/reject();
  // `pending_approval` is only ever set at creation.
  async updateStatus(orderId: string, status: (typeof orders.status.enumValues)[number]) {
    if (["pending_approval", "confirmed", "rejected"].includes(status)) {
      throw new BadRequestException("Use the approve / reject actions for this transition");
    }
    const [row] = await this.db
      .update(orders)
      .set({
        status,
        deliveredAt: status === "delivered" ? new Date() : undefined,
        updatedAt: new Date(),
      })
      .where(eq(orders.id, orderId))
      .returning();
    if (!row) throw new NotFoundException("Order not found");
    return this.attachItems(row);
  }

  /**
   * A verified buyer submits an order. It lands in `pending_approval` — no
   * credit is debited and no repayment schedule exists yet; a staff member
   * approves it (see {@link approve}), which is the actual credit grant.
   */
  async create(userId: string, input: CreateOrderInput) {
    await this.authService.assertTxnPin(userId, input.txnPin);
    await this.kyc.assertVerified(userId); // 403 NOT_VERIFIED otherwise

    return this.db.transaction(async (tx) => {
      const productIds = input.items.map((i) => i.productId);
      const productRows = await tx.select().from(products).where(inArray(products.id, productIds));
      const productById = new Map(productRows.map((p) => [p.id, p]));
      for (const item of input.items) {
        const product = productById.get(item.productId);
        if (!product || product.status !== "published" || !product.isAvailable) {
          throw new BadRequestException(`Product ${item.productId} is not available`);
        }
      }

      const [plan] = await tx.select().from(bnplPlans).where(eq(bnplPlans.id, input.bnplPlanId)).limit(1);
      if (!plan || !plan.isActive) throw new BadRequestException("Selected plan is not available");

      const subtotalKobo = input.items.reduce((sum, item) => {
        const price = productById.get(item.productId)!.priceKobo;
        return sum + price * BigInt(item.quantity);
      }, 0n);
      const totalKobo = subtotalKobo + DELIVERY_FEE_KOBO + percentOfKobo(subtotalKobo, SERVICE_FEE_PERCENT);

      const [order] = await tx
        .insert(orders)
        .values({
          userId,
          status: "pending_approval",
          subtotalKobo,
          deliveryFeeKobo: DELIVERY_FEE_KOBO,
          serviceFeeKobo: percentOfKobo(subtotalKobo, SERVICE_FEE_PERCENT),
          totalKobo,
          bnplPlanId: plan.id,
          deliveryAddress: input.deliveryAddress,
        })
        .returning();

      const items = await tx
        .insert(orderItems)
        .values(
          input.items.map((item) => {
            const product = productById.get(item.productId)!;
            return {
              orderId: order.id,
              productId: product.id,
              name: product.name,
              imageUrl: product.imageUrl,
              quantity: item.quantity,
              unitPriceKobo: product.priceKobo,
            };
          }),
        )
        .returning();

      return this.toResponse(order, items);
    });
  }

  /**
   * Staff approves a pending order. This is where the money moves: credit is
   * debited (the limit is auto-extended to cover the order if needed, with an
   * audit row — per-order approval *is* the credit decision in this flow), the
   * repayment schedule + ledger legs are written, and a delivery slot is set.
   * Returns the buyer id + slot so the caller can send the "approved" email.
   */
  async approve(orderId: string, staffId: string, deliverySlot?: string) {
    return this.db.transaction(async (tx) => {
      const [order] = await tx.select().from(orders).where(eq(orders.id, orderId)).limit(1);
      if (!order) throw new NotFoundException("Order not found");
      if (order.status !== "pending_approval") {
        throw new BadRequestException(`Order is already ${order.status}`);
      }
      const [plan] = await tx.select().from(bnplPlans).where(eq(bnplPlans.id, order.bnplPlanId)).limit(1);
      if (!plan) throw new BadRequestException("Order's plan no longer exists");

      let [profile] = await tx.select().from(creditProfiles).where(eq(creditProfiles.userId, order.userId)).limit(1);
      if (!profile) {
        [profile] = await tx
          .insert(creditProfiles)
          .values({ userId: order.userId, isVerified: true })
          .returning();
      }
      const usedKobo = profile.usedCreditKobo ?? 0n;
      const neededLimitKobo = usedKobo + order.totalKobo;
      if ((profile.creditLimitKobo ?? 0n) < neededLimitKobo) {
        await tx
          .update(creditProfiles)
          .set({ creditLimitKobo: neededLimitKobo, updatedAt: new Date() })
          .where(eq(creditProfiles.userId, order.userId));
        await tx.insert(creditLimitChanges).values({
          userId: order.userId,
          beforeKobo: profile.creditLimitKobo ?? 0n,
          afterKobo: neededLimitKobo,
          reason: `Auto-extended on approval of order ${order.id}`,
          actorStaffId: staffId,
        });
      }

      await tx
        .update(creditProfiles)
        .set({ usedCreditKobo: neededLimitKobo, updatedAt: new Date() })
        .where(eq(creditProfiles.userId, order.userId));

      await this.createRepaymentSchedule(tx, order, plan, order.userId);

      await this.ledger.post(tx, order.id, [
        { accountName: "Loans Receivable", accountType: "asset", direction: "D", amountKobo: order.totalKobo, orderId: order.id },
        { accountName: "Sales Revenue", accountType: "revenue", direction: "C", amountKobo: order.totalKobo, orderId: order.id },
      ]);

      const estimatedDeliveryAt = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000); // ~2 days
      const [updated] = await tx
        .update(orders)
        .set({
          status: "confirmed",
          approvedAt: new Date(),
          approvedByStaffId: staffId,
          deliverySlot: deliverySlot ?? null,
          estimatedDeliveryAt,
          updatedAt: new Date(),
        })
        .where(eq(orders.id, orderId))
        .returning();

      const response = await this.attachItems(updated);
      await this.notifyBuyer(order.userId, (name) =>
        emails.orderApproved(name, {
          total: koboToNaira(order.totalKobo).toLocaleString("en-NG", { style: "currency", currency: "NGN" }),
          deliverySlot: updated.deliverySlot,
          address: order.deliveryAddress,
        }),
      );
      return { ...response, userId: order.userId, deliverySlot: updated.deliverySlot };
    });
  }

  async reject(orderId: string, staffId: string, reason: string) {
    const [order] = await this.db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
    if (!order) throw new NotFoundException("Order not found");
    if (order.status !== "pending_approval") {
      throw new BadRequestException(`Order is already ${order.status}`);
    }
    const [updated] = await this.db
      .update(orders)
      .set({ status: "rejected", rejectionReason: reason, approvedByStaffId: staffId, updatedAt: new Date() })
      .where(eq(orders.id, orderId))
      .returning();
    const response = await this.attachItems(updated);
    await this.notifyBuyer(order.userId, (name) => emails.orderRejected(name, reason));
    return { ...response, userId: order.userId };
  }

  private async createRepaymentSchedule(
    tx: Tx,
    order: typeof orders.$inferSelect,
    plan: typeof bnplPlans.$inferSelect,
    userId: string,
  ) {
    const installments = plan.durationMonths === 0 ? 1 : plan.durationMonths;
    const totalWithFee = order.totalKobo + percentOfKobo(order.totalKobo, plan.interestPercent);
    const base = totalWithFee / BigInt(installments);
    const remainder = totalWithFee - base * BigInt(installments);

    const rows = Array.from({ length: installments }, (_, i) => {
      const n = i + 1;
      const amountKobo = n === installments ? base + remainder : base; // remainder absorbed by the last installment
      const dueDate =
        plan.durationMonths === 0
          ? new Date() // Pay Now — due immediately
          : new Date(Date.now() + n * 30 * DAY_MS);
      return {
        orderId: order.id,
        userId,
        installmentNumber: n,
        totalInstallments: installments,
        amountKobo,
        dueDate,
      };
    });

    await tx.insert(repaymentSchedules).values(rows);
  }

  // Naira/double shape matching the Flutter `Order`/`OrderItem` models
  // exactly (lib/features/orders/domain/models/order.dart) — the client
  // was written against this contract, not the other way around.
  private toResponse(order: typeof orders.$inferSelect, items: (typeof orderItems.$inferSelect)[]) {
    return {
      id: order.id,
      status: order.status,
      items: items.map((item) => ({
        productId: item.productId,
        name: item.name,
        imageUrl: item.imageUrl,
        quantity: item.quantity,
        unitPrice: koboToNaira(item.unitPriceKobo),
      })),
      subtotal: koboToNaira(order.subtotalKobo),
      deliveryFee: koboToNaira(order.deliveryFeeKobo),
      serviceFee: koboToNaira(order.serviceFeeKobo),
      total: koboToNaira(order.totalKobo),
      bnplPlanId: order.bnplPlanId,
      deliveryAddress: order.deliveryAddress,
      placedAt: order.placedAt,
      estimatedDelivery: order.estimatedDeliveryAt,
      deliveredAt: order.deliveredAt,
      approvedAt: order.approvedAt,
      deliverySlot: order.deliverySlot,
      rejectionReason: order.rejectionReason,
    };
  }
}
