import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { and, desc, eq, inArray } from "drizzle-orm";
import { koboToNaira, percentOfKobo } from "@farmermarket/core";
import {
  orders,
  orderItems,
  products,
  bnplPlans,
  creditProfiles,
  repaymentSchedules,
  users,
  type Db,
  type Tx,
} from "@farmermarket/db";
import { DB } from "../../db/db.module";
import { LedgerService } from "../ledger/ledger.service";
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
  ) {}

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

  async updateStatus(orderId: string, status: (typeof orders.status.enumValues)[number]) {
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
   * Places an order against the caller's own credit limit — the write that
   * makes Phase 3's "a limit approved on web is spendable [in the app]"
   * actually true (§15, Phase 3's done-when). Everything happens in one
   * transaction: prices are re-read from the DB (never trust the client's
   * numbers), the limit check is enforced before any write, and the order,
   * its repayment schedule, and its ledger legs commit together or not at
   * all — mirroring how ApplicationsService.decide() pairs a credit_profiles
   * write with its audit trail.
   */
  async create(userId: string, input: CreateOrderInput) {
    return this.db.transaction(async (tx) => {
      const productIds = input.items.map((i) => i.productId);
      const productRows = await tx
        .select()
        .from(products)
        .where(inArray(products.id, productIds));

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

      const [profile] = await tx.select().from(creditProfiles).where(eq(creditProfiles.userId, userId)).limit(1);
      const available = (profile?.creditLimitKobo ?? 0n) - (profile?.usedCreditKobo ?? 0n);
      if (!profile || available < totalKobo) {
        throw new BadRequestException("This order exceeds your available credit limit");
      }

      const [order] = await tx
        .insert(orders)
        .values({
          userId,
          subtotalKobo,
          deliveryFeeKobo: DELIVERY_FEE_KOBO,
          serviceFeeKobo: percentOfKobo(subtotalKobo, SERVICE_FEE_PERCENT),
          totalKobo,
          bnplPlanId: plan.id,
          deliveryAddress: input.deliveryAddress,
          estimatedDeliveryAt: new Date(Date.now() + 40 * 60 * 1000),
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

      await tx
        .update(creditProfiles)
        .set({ usedCreditKobo: (profile.usedCreditKobo ?? 0n) + totalKobo, updatedAt: new Date() })
        .where(eq(creditProfiles.userId, userId));

      await this.createRepaymentSchedule(tx, order, plan, userId);

      // Placing the order is the sale: the customer now owes the business
      // `totalKobo` (Loans Receivable, an asset — money owed to us) against
      // revenue recognized on the sale.
      await this.ledger.post(tx, order.id, [
        { accountName: "Loans Receivable", accountType: "asset", direction: "D", amountKobo: totalKobo, orderId: order.id },
        { accountName: "Sales Revenue", accountType: "revenue", direction: "C", amountKobo: totalKobo, orderId: order.id },
      ]);

      return this.toResponse(order, items);
    });
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
    };
  }
}
