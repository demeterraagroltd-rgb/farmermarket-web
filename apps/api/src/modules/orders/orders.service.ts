import { BadRequestException, Inject, Injectable, NotFoundException, Optional } from "@nestjs/common";
import { and, desc, eq } from "drizzle-orm";
import { koboToNaira, percentOfKobo } from "@farmermarket/core";
import {
  orders,
  orderItems,
  pickupCenters,
  bnplPlans,
  creditProfiles,
  creditLimitChanges,
  repaymentSchedules,
  users,
  auditLogs,
  recovaConsents,
  type Db,
  type Tx,
} from "@farmermarket/db";
import { DB } from "../../db/db.module";
import { LedgerService } from "../ledger/ledger.service";
import { AuthService } from "../auth/auth.service";
import { KycService } from "../kyc/kyc.service";
import { EmailService } from "../notifications/email.service";
import { emails } from "../notifications/templates";
import { customerLinks } from "../notifications/links";
import { SMS_SENDER, type SmsSender } from "../integrations/sms/sms.types";
import { consentSetupStatus } from "../recova/recova-consent.config";
import { normalisePhone, isNigerianMobile } from "../../common/phone";
import { recordOrderReservation, recordOrderFulfilment } from "../inventory/inventory-stock";
import { cancelRecovaForOrder } from "../recova/recova-cancel";
import { reserveOrderLines, releaseOrderStock } from "./order-inventory";
import { buildInstallments, canUseTestPlans, isPayNow } from "./installments";
import type { CreateOrderInput } from "./dto/create-order.dto";

// Hardcoded to match the Flutter app's `Cart` fees exactly (§5.7) — both
// sides need to move onto the `config` table's `fees` key together so a fee
// change is one dashboard edit, not two code changes. Out of scope here.
const DELIVERY_FEE_KOBO = 50_000n; // ₦500
const SERVICE_FEE_PERCENT = 3;

/** "25 Sep 2026" — the shape the emails and the order pages both read. */
function shortDate(d: Date | null): string | null {
  return d ? d.toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric" }) : null;
}

@Injectable()
export class OrdersService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly ledger: LedgerService,
    private readonly authService: AuthService,
    private readonly kyc: KycService,
    private readonly email: EmailService,
    // Optional: tests and the isolated practice journey construct this without SMS.
    @Inject(SMS_SENDER) @Optional() private readonly sms?: SmsSender,
  ) {}

  /** Recova repayment setup is offered once its encrypted draft storage exists. */
  private recovaSetupOffered() {
    return consentSetupStatus().draftAvailable;
  }

  /**
   * Tell the buyer how to set up repayment for an approved order: email plus
   * SMS. The link opens their order page, where they enter their bank account
   * and get Recova's approval link. Sends nothing to Recova itself.
   */
  async sendRepaymentSetupLink(orderId: string, staffId?: string) {
    const [order] = await this.db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
    if (!order) throw new NotFoundException("Order not found");
    if ((order.status !== "pending_approval" && !order.approvedAt) || ["cancelled", "rejected"].includes(order.status)) {
      throw new BadRequestException("Only open orders need repayment setup.");
    }
    if (!this.recovaSetupOffered()) throw new BadRequestException("Recova repayment setup is not configured on this server.");
    const [plan] = await this.db.select().from(bnplPlans).where(eq(bnplPlans.id, order.bnplPlanId)).limit(1);
    if (plan && isPayNow(plan)) throw new BadRequestException("Pay Now orders are paid in full, so they don't need Recova repayment setup.");
    const [consent] = await this.db.select({ status: recovaConsents.status }).from(recovaConsents).where(eq(recovaConsents.orderId, orderId)).limit(1);
    if (consent && ["submitting", "processing", "active"].includes(consent.status)) {
      throw new BadRequestException("This order's Recova repayment is already set up.");
    }
    const [u] = await this.db
      .select({ fullName: users.fullName, email: users.email, phone: users.phone })
      .from(users).where(eq(users.id, order.userId)).limit(1);
    if (!u) throw new NotFoundException("Customer not found");
    const total = koboToNaira(order.totalKobo).toLocaleString("en-NG", { style: "currency", currency: "NGN" });
    const link = customerLinks.order(orderId);

    let email: "sent" | "no_email" = "no_email";
    if (u.email) {
      void this.email.send({ to: u.email, ...emails.repaymentSetup(u.fullName ?? "there", { orderId, total }) });
      email = "sent";
    }
    let sms: "sent" | "failed" | "not_configured" | "invalid_phone" = "not_configured";
    const phone = normalisePhone(u.phone);
    if (!isNigerianMobile(phone)) sms = "invalid_phone";
    else if (this.sms?.live) {
      try {
        await this.sms.send(phone, `Farmer Market: your order of ${total} is approved. Set up your repayment to complete it: ${link}`);
        sms = "sent";
      } catch {
        sms = "failed";
      }
    }
    if (staffId) {
      await this.db.insert(auditLogs).values({
        actorStaffId: staffId, action: "order.repayment_setup_link_sent", targetType: "order", targetId: orderId,
        metadata: { email, sms },
      });
    }
    return { email, sms, link };
  }

  private async notifyBuyer(userId: string, build: (name: string, email: string | null) => { subject: string; html: string }) {
    const [u] = await this.db
      .select({ fullName: users.fullName, email: users.email })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!u) return;
    void this.email.send({ to: u.email, ...build(u.fullName ?? "there", u.email) });
  }

  async plansForUser(userId: string) {
    const [u] = await this.db.select({ phone: users.phone }).from(users).where(eq(users.id, userId)).limit(1);
    const rows = await this.db.select().from(bnplPlans).where(eq(bnplPlans.isActive, true)).orderBy(bnplPlans.sortOrder);
    return rows.filter((p) => !p.testOnly || canUseTestPlans(u?.phone));
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

  /** Single-order staff read — the Order Review workspace's base fetch. */
  async findOneForStaff(orderId: string) {
    const [row] = await this.db
      .select({
        order: orders,
        buyerName: users.fullName,
        buyerPhone: users.phone,
        buyerEmail: users.email,
        plan: bnplPlans,
      })
      .from(orders)
      .leftJoin(users, eq(orders.userId, users.id))
      .leftJoin(bnplPlans, eq(orders.bnplPlanId, bnplPlans.id))
      .where(eq(orders.id, orderId))
      .limit(1);
    if (!row) throw new NotFoundException("Order not found");

    const items = await this.db.select().from(orderItems).where(eq(orderItems.orderId, row.order.id));
    return {
      ...this.toResponse(row.order, items),
      userId: row.order.userId,
      totalKobo: row.order.totalKobo, // internal — OrderReviewService needs the exact kobo figure for the preview schedule
      buyerName: row.buyerName ?? null,
      buyerPhone: row.buyerPhone ?? null,
      buyerEmail: row.buyerEmail ?? null,
      bnplPlanName: row.plan?.name ?? null,
      bnplPlan: row.plan ?? null,
    };
  }

  // Post-approval lifecycle only (preparing → on_the_way → delivered,
  // cancelled). Entering `confirmed`/`rejected` goes through approve()/reject();
  // `pending_approval` is only ever set at creation.
  async updateStatus(orderId: string, status: (typeof orders.status.enumValues)[number], actorStaffId?: string) {
    if (["pending_approval", "confirmed", "rejected"].includes(status)) {
      throw new BadRequestException("Use the approve / reject actions for this transition");
    }
    if (status === "cancelled") {
      const [current] = await this.db.select({ status: orders.status }).from(orders).where(eq(orders.id, orderId)).limit(1);
      if (current && !["rejected", "cancelled", "delivered", "pending_approval"].includes(current.status)) {
        await cancelRecovaForOrder(this.db, orderId, "Order cancelled");
      }
    }
    return this.db.transaction(async (tx) => {
      const [order] = await tx.select().from(orders).where(eq(orders.id, orderId)).for("update");
      if (!order) throw new NotFoundException("Order not found");
      if (["rejected", "cancelled", "delivered"].includes(order.status)) throw new BadRequestException("This order is already closed");
      if (order.status === "pending_approval") throw new BadRequestException("Approve or reject the pending order first");
      if (status === "cancelled") await releaseOrderStock(tx, order, actorStaffId);
      if (status === "delivered" && order.stockReserved) {
        const lines = await tx.select().from(orderItems).where(eq(orderItems.orderId, orderId));
        await recordOrderFulfilment(tx, orderId, lines, actorStaffId,order.stockWarehouseId);
      }
      const [row] = await tx.update(orders).set({ status,
        deliveredAt: status === "delivered" ? new Date() : undefined,
        ...(status === "delivered" ? { stockReserved: false } : {}), updatedAt: new Date(),
      }).where(eq(orders.id, orderId)).returning();
      const items = await tx.select().from(orderItems).where(eq(orderItems.orderId, orderId));
      return this.toResponse(row, items);
    });
  }

  /**
   * A verified buyer submits an order. It lands in `pending_approval` — no
   * credit is debited and no repayment schedule exists yet; a staff member
   * approves it (see {@link approve}), which is the actual credit grant.
   */
  async create(userId: string, input: CreateOrderInput) {
    await this.authService.assertTxnPin(userId, input.txnPin);
    // Submitted applications can order and set up repayment straight away;
    // staff check documents before approving the order.
    await this.kyc.assertSubmitted(userId); // 403 NOT_SUBMITTED otherwise
    const [buyer] = await this.db.select({ phone: users.phone }).from(users).where(eq(users.id, userId)).limit(1);
    let repaymentSetup = false;

    const response = await this.db.transaction(async (tx) => {
      const resolvedLines = await reserveOrderLines(tx, input.items,input.pickupCenterId);

      const [plan] = await tx.select().from(bnplPlans).where(eq(bnplPlans.id, input.bnplPlanId)).limit(1);
      if (!plan || !plan.isActive || (plan.testOnly && !canUseTestPlans(buyer?.phone))) throw new BadRequestException("Selected plan is not available");

      const [centre] = await tx
        .select()
        .from(pickupCenters)
        .where(eq(pickupCenters.id, input.pickupCenterId))
        .limit(1);
      if (!centre || !centre.isActive) {
        throw new BadRequestException("That pickup centre isn't available — choose another");
      }

      const subtotalKobo = resolvedLines.reduce((sum, item) => sum + item.unitPriceKobo * BigInt(item.quantity), 0n);
      const totalKobo = subtotalKobo + DELIVERY_FEE_KOBO + percentOfKobo(subtotalKobo, SERVICE_FEE_PERCENT);

      const [order] = await tx
        .insert(orders)
        .values({
          userId,
          status: "pending_approval",
          stockReserved: true,
          stockWarehouseId:input.pickupCenterId,
          subtotalKobo,
          deliveryFeeKobo: DELIVERY_FEE_KOBO,
          serviceFeeKobo: percentOfKobo(subtotalKobo, SERVICE_FEE_PERCENT),
          totalKobo,
          bnplPlanId: plan.id,
          pickupCenterId: centre.id,
          pickupCenterName: centre.name,
          pickupCenterAddress: centre.address,
          pickupDate: input.pickupDate,
        })
        .returning();
      repaymentSetup = this.recovaSetupOffered() && !isPayNow(plan);

      const items = await tx
        .insert(orderItems)
        .values(
          resolvedLines.map((item) => ({ ...item, orderId: order.id })),
        )
        .returning();

      await recordOrderReservation(tx, order.id, items,input.pickupCenterId);
      return this.toResponse(order, items);
    });

    // "We've got your order" — it's in pending_approval; the approve/reject
    // emails follow later. Fire-and-forget.
    await this.notifyBuyer(userId, (name) =>
      emails.orderReceived(name, {
        orderId: response.id,
        total: response.total.toLocaleString("en-NG", { style: "currency", currency: "NGN" }),
        pickupCenter: [response.pickupCenterName, response.pickupCenterAddress]
          .filter(Boolean)
          .join(", "),
        pickupDate: shortDate(response.pickupDate),
        repaymentSetup,
      }),
    );
    if (repaymentSetup && this.sms?.live && buyer && isNigerianMobile(normalisePhone(buyer.phone))) {
      this.sms.send(normalisePhone(buyer.phone), `Farmer Market: we've got your order. Set up your repayment so we can approve it: ${customerLinks.order(response.id)}`)
        .catch(() => undefined);
    }

    return response;
  }

  /**
   * Staff approves a pending order. This is where the money moves: credit is
   * debited (the limit is auto-extended to cover the order if needed, with an
   * audit row — per-order approval *is* the credit decision in this flow), the
   * repayment schedule + ledger legs are written, and a delivery slot is set.
   * Returns the buyer id + slot so the caller can send the "approved" email.
   */
  async approve(orderId: string, staffId: string, deliverySlot?: string) {
    const { updated, userId } = await this.db.transaction(async (tx) => {
      const [order] = await tx.select().from(orders).where(eq(orders.id, orderId)).limit(1).for("update");
      if (!order) throw new NotFoundException("Order not found");
      if (order.status !== "pending_approval") {
        throw new BadRequestException(`Order is already ${order.status}`);
      }
      const [plan] = await tx.select().from(bnplPlans).where(eq(bnplPlans.id, order.bnplPlanId)).limit(1);
      if (!plan) throw new BadRequestException("Order's plan no longer exists");

      // Re-check at approval time, not just at checkout (create() already
      // gates on this, but a profile can regress to needs_more_info in
      // between) — this is the hard "Verification Required" gate the Order
      // Review workspace's Approve button also enforces client-side.
      const status = await this.kyc.getVerificationStatus(order.userId);
      if (status !== "verified") {
        throw new BadRequestException("Applicant is not verified — verification is required before approval");
      }
      if (!isPayNow(plan)) {
        // Dates were fixed when the order was placed and the customer may already
        // have authorized them with Recova. Goods must not go out after a
        // collection date has already passed.
        if (buildInstallments(order.totalKobo, plan, order.placedAt)[0].dueDate <= new Date()) {
          throw new BadRequestException("This order's first repayment date has already passed. Reject it and ask the customer to order again.");
        }
        if (consentSetupStatus().submissionEnabled) {
          const [consent] = await tx.select({ status: recovaConsents.status }).from(recovaConsents).where(eq(recovaConsents.orderId, orderId)).limit(1);
          if (consent?.status !== "active") {
            throw new BadRequestException("The customer's Recova repayment mandate isn't active yet. Approve once it shows as active.");
          }
        }
      }

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

      return { updated, userId: order.userId };
    });
    // Response hydration uses the root DB connection. Do it only after commit:
    // a single-connection adapter cannot serve it while the transaction is open.
    // A buyer notification must also describe a committed approval.
    const response = await this.attachItems(updated);
    await this.notifyBuyer(userId, (name) =>
      emails.orderApproved(name, {
        orderId,
        total: koboToNaira(updated.totalKobo).toLocaleString("en-NG", { style: "currency", currency: "NGN" }),
        deliverySlot: updated.deliverySlot,
        pickupCenter: [updated.pickupCenterName, updated.pickupCenterAddress].filter(Boolean).join(", "),
        pickupDate: shortDate(updated.pickupDate),
        // Repayment is set up before approval now, so approval only confirms.
        repaymentSetup: false,
      }),
    );
    return { ...response, userId, deliverySlot: updated.deliverySlot };
  }

  async reject(orderId: string, staffId: string, reason: string) {
    const [current] = await this.db.select({ status: orders.status }).from(orders).where(eq(orders.id, orderId)).limit(1);
    if (!current) throw new NotFoundException("Order not found");
    if (current.status !== "pending_approval") throw new BadRequestException(`Order is already ${current.status}`);
    // Stop Recova first; if it can't confirm, the order stays pending for a retry.
    await cancelRecovaForOrder(this.db, orderId, `Order rejected: ${reason}`);
    const result = await this.db.transaction(async (tx) => {
      const [order] = await tx.select().from(orders).where(eq(orders.id, orderId)).for("update");
      if (!order) throw new NotFoundException("Order not found");
      if (order.status !== "pending_approval") throw new BadRequestException(`Order is already ${order.status}`);
      await releaseOrderStock(tx, order, staffId);
      const [updated] = await tx.update(orders).set({ status: "rejected", rejectionReason: reason,
        approvedByStaffId: staffId, updatedAt: new Date() }).where(eq(orders.id, orderId)).returning();
      const items = await tx.select().from(orderItems).where(eq(orderItems.orderId, orderId));
      return { ...this.toResponse(updated, items), userId: order.userId };
    });
    await this.notifyBuyer(result.userId, (name) => emails.orderRejected(name, { orderId, reason }));
    return result;
  }

  /** Order Review workspace: what the schedule *will* look like on approval. */
  previewInstallments(totalKobo: bigint, plan: typeof bnplPlans.$inferSelect, placedAt: Date) {
    return buildInstallments(totalKobo, plan, placedAt).map((i) => ({
      ...i,
      amount: koboToNaira(i.amountKobo),
    }));
  }

  private async createRepaymentSchedule(
    tx: Tx,
    order: typeof orders.$inferSelect,
    plan: typeof bnplPlans.$inferSelect,
    userId: string,
  ) {
    const rows = buildInstallments(order.totalKobo, plan, order.placedAt).map((i) => ({
      ...i,
      orderId: order.id,
      userId,
    }));

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
        bundleId: item.bundleId,
        kind: item.bundleId ? "bundle" : "product",
        components: item.components.map((i) => ({ ...i, unitPrice: koboToNaira(BigInt(i.unitPriceKobo)), totalQuantity: i.quantity * item.quantity })),
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
      pickupCenterId: order.pickupCenterId,
      pickupCenterName: order.pickupCenterName,
      pickupCenterAddress: order.pickupCenterAddress,
      pickupDate: order.pickupDate,
      // Legacy: orders placed before pickup centres existed carry the buyer's
      // street address instead. Null on every new order.
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
