import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { and, asc, desc, eq, gt, inArray, isNotNull, lte, sql } from "drizzle-orm";
import { koboToNaira, nairaToKobo } from "@farmermarket/core";
import {
  categories,
  orderItems,
  orders,
  products,
  staff,
  stockLots,
  stockMovements,
  vendors,
  type Db,
  type Tx,
} from "@farmermarket/db";
import { DB } from "../../db/db.module";
import { EmailService } from "../notifications/email.service";
import { emails } from "../notifications/templates";
import type { AdjustStockInput, ReceiveStockInput } from "./dto/inventory.dto";

type Order = typeof orders.$inferSelect;
type Line = { productId: string; quantity: number };

/** Machine-readable marker the phone and web apps branch on (see ApiException.code). */
export const OUT_OF_STOCK = "OUT_OF_STOCK";

const DAY_MS = 24 * 60 * 60 * 1000;
const EXPIRY_WARNING_DAYS = 30;

/** How long a pending order may hold stock before the daily sweep releases it. */
function reservationDays(): number {
  const n = Number(process.env.INVENTORY_RESERVATION_DAYS);
  return Number.isFinite(n) && n > 0 ? n : 7;
}

/** Duplicate lines for one product collapse into one; sorted so concurrent orders lock rows in the same order. */
function consolidate(lines: Line[]): Line[] {
  const byProduct = new Map<string, number>();
  for (const l of lines) byProduct.set(l.productId, (byProduct.get(l.productId) ?? 0) + l.quantity);
  return [...byProduct.entries()]
    .map(([productId, quantity]) => ({ productId, quantity }))
    .sort((a, b) => a.productId.localeCompare(b.productId));
}

function yymmdd(d: Date): string {
  return d.toISOString().slice(2, 10).replace(/-/g, "");
}

/** "Golden Penny Rice 50kg" → "GOLD"; a SKU wins when there is one. */
function lotPrefix(p: { sku: string | null; name: string }): string {
  const source = p.sku ?? p.name;
  return source.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6) || "LOT";
}

/**
 * The only writer of stock. Every change goes through here so the totals on
 * `products` and the `stock_movements` journal can't drift apart:
 *
 *   on hand (products.stock_quantity)  = Σ lot remaining = Σ on_hand_delta
 *   reserved (products.stock_reserved) = Σ reserved_delta
 *   available                          = on hand − reserved
 *
 * The order hooks take the caller's transaction, so stock moves or doesn't
 * with the order change that caused it.
 */
@Injectable()
export class InventoryService {
  private readonly log = new Logger(InventoryService.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly email: EmailService,
  ) {}

  // ── Order lifecycle ──────────────────────────────────────────────────────

  /**
   * Holds stock for a just-submitted order. Each product is a single
   * conditional UPDATE — two buyers racing for the last bag can't both win,
   * because the second one's `available >= qty` check sees the first's hold.
   */
  async reserveForOrder(tx: Tx, orderId: string, lines: Line[]) {
    for (const { productId, quantity } of consolidate(lines)) {
      const [held] = await tx
        .update(products)
        .set({ stockReserved: sql`${products.stockReserved} + ${quantity}`, updatedAt: new Date() })
        .where(
          and(
            eq(products.id, productId),
            sql`${products.stockQuantity} - ${products.stockReserved} >= ${quantity}`,
          ),
        )
        .returning({ id: products.id });

      if (!held) {
        const [p] = await tx
          .select({ name: products.name, onHand: products.stockQuantity, reserved: products.stockReserved })
          .from(products)
          .where(eq(products.id, productId))
          .limit(1);
        const available = p ? Math.max(0, p.onHand - p.reserved) : 0;
        throw new ConflictException({
          statusCode: 409,
          code: OUT_OF_STOCK,
          productId,
          available,
          message:
            available === 0
              ? `${p?.name ?? "An item in your cart"} is out of stock. Remove it to continue.`
              : `Only ${available} left of ${p?.name}. Reduce the quantity to continue.`,
        });
      }

      await tx.insert(stockMovements).values({ productId, type: "reserve", reservedDelta: quantity, orderId });
    }
    await tx.update(orders).set({ stockState: "reserved" }).where(eq(orders.id, orderId));
  }

  /** Puts a not-yet-dispatched order's hold back on the shelf (reject, cancel, expiry). */
  async releaseForOrder(tx: Tx, order: Order, staffId: string | null, note: string) {
    if (order.stockState !== "reserved") return;
    for (const { productId, quantity } of await this.heldForOrder(tx, order.id)) {
      await tx
        .update(products)
        .set({ stockReserved: sql`${products.stockReserved} - ${quantity}`, updatedAt: new Date() })
        .where(eq(products.id, productId));
      await tx.insert(stockMovements).values({
        productId,
        type: "release",
        reservedDelta: -quantity,
        orderId: order.id,
        staffId,
        note,
      });
    }
    await tx.update(orders).set({ stockState: "released" }).where(eq(orders.id, order.id));
  }

  /**
   * An order whose hold was released (it sat pending too long) is being
   * approved after all — take the stock again, or refuse if it's gone.
   */
  async reReserveForOrder(tx: Tx, order: Order) {
    if (order.stockState !== "released") return;
    const lines = await tx
      .select({ productId: orderItems.productId, quantity: orderItems.quantity })
      .from(orderItems)
      .where(eq(orderItems.orderId, order.id));
    await this.reserveForOrder(
      tx,
      order.id,
      lines.filter((l): l is Line => l.productId !== null),
    );
  }

  /**
   * The order leaves the warehouse: its held quantity comes off the oldest
   * lots first (FIFO by received date), and off both on-hand and reserved.
   */
  async dispatchForOrder(tx: Tx, order: Order, staffId: string | null) {
    if (order.stockState !== "reserved") return;
    for (const { productId, quantity } of await this.heldForOrder(tx, order.id)) {
      const lots = await tx
        .select({ id: stockLots.id, remaining: stockLots.quantityRemaining })
        .from(stockLots)
        .where(and(eq(stockLots.productId, productId), gt(stockLots.quantityRemaining, 0)))
        .orderBy(asc(stockLots.receivedAt), asc(stockLots.createdAt), asc(stockLots.id))
        .for("update");

      let need = quantity;
      for (const lot of lots) {
        if (need === 0) break;
        const take = Math.min(need, lot.remaining);
        await tx
          .update(stockLots)
          .set({ quantityRemaining: lot.remaining - take })
          .where(eq(stockLots.id, lot.id));
        await tx.insert(stockMovements).values({
          productId,
          lotId: lot.id,
          type: "dispatch",
          onHandDelta: -take,
          reservedDelta: -take,
          orderId: order.id,
          staffId,
        });
        need -= take;
      }
      if (need > 0) {
        // Can't happen while the invariants hold (reserved ≤ on hand = Σ lots);
        // if it does, stop rather than dispatch goods the books don't have.
        throw new InternalServerErrorException(
          `Stock records for product ${productId} don't add up — lots are ${need} short of this order. Check the inventory history.`,
        );
      }
      await tx
        .update(products)
        .set({
          stockQuantity: sql`${products.stockQuantity} - ${quantity}`,
          stockReserved: sql`${products.stockReserved} - ${quantity}`,
          updatedAt: new Date(),
        })
        .where(eq(products.id, productId));
    }
    await tx.update(orders).set({ stockState: "dispatched" }).where(eq(orders.id, order.id));
  }

  /** A dispatched order was cancelled and its goods came back — each unit to the lot it left. */
  async returnForOrder(tx: Tx, order: Order, staffId: string | null) {
    if (order.stockState !== "dispatched") return;
    const taken = await tx
      .select({
        productId: stockMovements.productId,
        lotId: stockMovements.lotId,
        quantity: sql<number>`(-sum(${stockMovements.onHandDelta}))::int`,
      })
      .from(stockMovements)
      .where(
        and(
          eq(stockMovements.orderId, order.id),
          inArray(stockMovements.type, ["dispatch", "return"]),
          isNotNull(stockMovements.lotId),
        ),
      )
      .groupBy(stockMovements.productId, stockMovements.lotId);

    for (const { productId, lotId, quantity } of taken) {
      if (quantity <= 0) continue;
      await tx
        .update(stockLots)
        .set({ quantityRemaining: sql`${stockLots.quantityRemaining} + ${quantity}` })
        .where(eq(stockLots.id, lotId!));
      await tx
        .update(products)
        .set({ stockQuantity: sql`${products.stockQuantity} + ${quantity}`, updatedAt: new Date() })
        .where(eq(products.id, productId));
      await tx.insert(stockMovements).values({
        productId,
        lotId,
        type: "return",
        onHandDelta: quantity,
        orderId: order.id,
        staffId,
        note: "Order cancelled after dispatch",
      });
    }
    await tx.update(orders).set({ stockState: "returned" }).where(eq(orders.id, order.id));
  }

  /** Net quantity an order currently holds, per product, read from the journal. */
  private async heldForOrder(tx: Tx, orderId: string): Promise<Line[]> {
    const rows = await tx
      .select({
        productId: stockMovements.productId,
        quantity: sql<number>`sum(${stockMovements.reservedDelta})::int`,
      })
      .from(stockMovements)
      .where(eq(stockMovements.orderId, orderId))
      .groupBy(stockMovements.productId);
    return rows.filter((r) => r.quantity > 0).sort((a, b) => a.productId.localeCompare(b.productId));
  }

  // ── Admin: goods in and corrections ──────────────────────────────────────

  async receive(input: ReceiveStockInput, staffId: string) {
    const receivedAt = input.receivedAt ?? new Date();
    if (receivedAt.getTime() > Date.now() + 60_000) {
      throw new BadRequestException("Received date can't be in the future");
    }
    return this.db.transaction(async (tx) => {
      const [product] = await tx.select().from(products).where(eq(products.id, input.productId)).limit(1);
      if (!product) throw new NotFoundException("Product not found");
      if (input.vendorId) {
        const [v] = await tx.select({ id: vendors.id }).from(vendors).where(eq(vendors.id, input.vendorId)).limit(1);
        if (!v) throw new BadRequestException("Vendor not found");
      }

      const base = `${lotPrefix(product)}-${yymmdd(receivedAt)}`;
      const [{ n }] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(stockLots)
        .where(sql`${stockLots.lotCode} LIKE ${base + "-%"}`);

      const [lot] = await tx
        .insert(stockLots)
        .values({
          productId: product.id,
          lotCode: `${base}-${n + 1}`,
          quantityReceived: input.quantity,
          quantityRemaining: input.quantity,
          receivedAt,
          expiryDate: input.expiryDate,
          unitCostKobo: input.unitCostNaira !== undefined ? nairaToKobo(input.unitCostNaira) : undefined,
          vendorId: input.vendorId,
          note: input.note,
          createdByStaffId: staffId,
        })
        .returning();
      await tx
        .update(products)
        .set({ stockQuantity: sql`${products.stockQuantity} + ${input.quantity}`, updatedAt: new Date() })
        .where(eq(products.id, product.id));
      await tx.insert(stockMovements).values({
        productId: product.id,
        lotId: lot.id,
        type: "receive",
        onHandDelta: input.quantity,
        staffId,
        note: input.note,
      });
      return this.toLot(lot);
    });
  }

  async adjust(input: AdjustStockInput, staffId: string) {
    return this.db.transaction(async (tx) => {
      const [lot] = await tx.select().from(stockLots).where(eq(stockLots.id, input.lotId)).for("update").limit(1);
      if (!lot) throw new NotFoundException("Lot not found");
      const [product] = await tx
        .select()
        .from(products)
        .where(eq(products.id, lot.productId))
        .for("update")
        .limit(1);

      const newRemaining = lot.quantityRemaining + input.quantityDelta;
      if (newRemaining < 0) {
        throw new BadRequestException(`Lot ${lot.lotCode} only has ${lot.quantityRemaining} left`);
      }
      if (newRemaining > lot.quantityReceived) {
        throw new BadRequestException(
          `Lot ${lot.lotCode} was received with ${lot.quantityReceived} — record extra goods as a new delivery instead`,
        );
      }
      const newOnHand = product.stockQuantity + input.quantityDelta;
      if (newOnHand < product.stockReserved) {
        throw new BadRequestException(
          `${product.stockReserved} of ${product.name} are reserved for orders, so on hand can't go below that. ` +
            `Reject or cancel an order first, or adjust by at most ${product.stockQuantity - product.stockReserved}.`,
        );
      }

      const [updated] = await tx
        .update(stockLots)
        .set({ quantityRemaining: newRemaining })
        .where(eq(stockLots.id, lot.id))
        .returning();
      await tx
        .update(products)
        .set({ stockQuantity: newOnHand, updatedAt: new Date() })
        .where(eq(products.id, product.id));
      await tx.insert(stockMovements).values({
        productId: product.id,
        lotId: lot.id,
        type: "adjust",
        onHandDelta: input.quantityDelta,
        reason: input.reason,
        note: input.note,
        staffId,
      });
      return this.toLot(updated);
    });
  }

  async updateThreshold(productId: string, lowStockThreshold: number) {
    const [row] = await this.db
      .update(products)
      .set({ lowStockThreshold, updatedAt: new Date() })
      .where(eq(products.id, productId))
      .returning({ id: products.id, lowStockThreshold: products.lowStockThreshold });
    if (!row) throw new NotFoundException("Product not found");
    return row;
  }

  // ── Admin: reads ─────────────────────────────────────────────────────────

  /** The inventory table: one row per product with its totals and soonest expiry. */
  async listStock() {
    const lotStats = this.db
      .select({
        productId: stockLots.productId,
        activeLots: sql<number>`count(*)::int`.as("active_lots"),
        nextExpiry: sql<string | null>`min(${stockLots.expiryDate})`.as("next_expiry"),
      })
      .from(stockLots)
      .where(gt(stockLots.quantityRemaining, 0))
      .groupBy(stockLots.productId)
      .as("lot_stats");

    const rows = await this.db
      .select({
        product: products,
        category: categories.name,
        activeLots: lotStats.activeLots,
        nextExpiry: lotStats.nextExpiry,
      })
      .from(products)
      .innerJoin(categories, eq(products.categoryId, categories.id))
      .leftJoin(lotStats, eq(lotStats.productId, products.id))
      .where(sql`${products.status} <> 'archived'`)
      .orderBy(asc(products.name));

    return rows.map(({ product: p, category, activeLots, nextExpiry }) => ({
      ...this.levels(p),
      productId: p.id,
      name: p.name,
      sku: p.sku,
      unit: p.unit,
      imageUrl: p.imageUrl,
      category,
      status: p.status,
      activeLots: activeLots ?? 0,
      nextExpiry,
    }));
  }

  /** One product's page: totals, every lot (newest first), and its recent history. */
  async getProductStock(productId: string) {
    const [p] = await this.db.select().from(products).where(eq(products.id, productId)).limit(1);
    if (!p) throw new NotFoundException("Product not found");

    const lots = await this.db
      .select({ lot: stockLots, vendorName: vendors.name })
      .from(stockLots)
      .leftJoin(vendors, eq(stockLots.vendorId, vendors.id))
      .where(eq(stockLots.productId, productId))
      .orderBy(desc(stockLots.receivedAt), desc(stockLots.createdAt));

    return {
      productId: p.id,
      name: p.name,
      sku: p.sku,
      unit: p.unit,
      imageUrl: p.imageUrl,
      status: p.status,
      ...this.levels(p),
      lots: lots.map(({ lot, vendorName }) => ({ ...this.toLot(lot), vendorName })),
      movements: await this.listMovements({ productId, limit: 100 }),
    };
  }

  async listMovements({ productId, limit = 200 }: { productId?: string; limit?: number }) {
    const rows = await this.db
      .select({
        m: stockMovements,
        productName: products.name,
        lotCode: stockLots.lotCode,
        staffName: staff.fullName,
      })
      .from(stockMovements)
      .innerJoin(products, eq(stockMovements.productId, products.id))
      .leftJoin(stockLots, eq(stockMovements.lotId, stockLots.id))
      .leftJoin(staff, eq(stockMovements.staffId, staff.id))
      .where(productId ? eq(stockMovements.productId, productId) : undefined)
      .orderBy(desc(stockMovements.id))
      .limit(Math.min(limit, 500));

    return rows.map(({ m, productName, lotCode, staffName }) => ({
      id: m.id.toString(),
      type: m.type,
      productId: m.productId,
      productName,
      lotId: m.lotId,
      lotCode,
      onHandDelta: m.onHandDelta,
      reservedDelta: m.reservedDelta,
      orderId: m.orderId,
      reason: m.reason,
      note: m.note,
      staffName, // null = the system (a buyer's checkout, the daily sweep)
      createdAt: m.createdAt,
    }));
  }

  /**
   * Which lots to pull for an order. Before dispatch it's the FIFO plan
   * (nothing consumed yet); after, it's what was actually taken.
   */
  async pickList(orderId: string) {
    const [order] = await this.db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
    if (!order) throw new NotFoundException("Order not found");

    const items = await this.db
      .select({ productId: orderItems.productId, name: orderItems.name, quantity: orderItems.quantity })
      .from(orderItems)
      .where(eq(orderItems.orderId, orderId));
    const names = new Map(items.map((r) => [r.productId, r.name]));

    const lines: {
      productId: string;
      name: string;
      quantity: number;
      lots: { lotId: string; lotCode: string; quantity: number; expiryDate: string | null }[];
      shortBy: number;
    }[] = [];

    if (order.stockState === "dispatched" || order.stockState === "returned") {
      const taken = await this.db
        .select({
          productId: stockMovements.productId,
          lotId: stockLots.id,
          lotCode: stockLots.lotCode,
          expiryDate: stockLots.expiryDate,
          quantity: sql<number>`(-sum(${stockMovements.onHandDelta}) FILTER (WHERE ${stockMovements.type} = 'dispatch'))::int`,
        })
        .from(stockMovements)
        .innerJoin(stockLots, eq(stockMovements.lotId, stockLots.id))
        .where(eq(stockMovements.orderId, orderId))
        .groupBy(stockMovements.productId, stockLots.id, stockLots.lotCode, stockLots.expiryDate, stockLots.receivedAt)
        .orderBy(asc(stockLots.receivedAt));
      for (const t of taken) {
        let line = lines.find((l) => l.productId === t.productId);
        if (!line) {
          line = { productId: t.productId, name: names.get(t.productId) ?? "", quantity: 0, lots: [], shortBy: 0 };
          lines.push(line);
        }
        line.quantity += t.quantity;
        line.lots.push({ lotId: t.lotId, lotCode: t.lotCode, quantity: t.quantity, expiryDate: t.expiryDate });
      }
    } else {
      // Reserved: exactly what's held. Otherwise (released, or a pre-inventory
      // order) plan from the order lines, so staff still get a pick list.
      const wanted =
        order.stockState === "reserved"
          ? await this.heldForOrder(this.db as unknown as Tx, orderId)
          : consolidate(items.filter((i): i is Line & { name: string } => i.productId !== null));
      for (const { productId, quantity } of wanted) {
        const lots = await this.db
          .select()
          .from(stockLots)
          .where(and(eq(stockLots.productId, productId), gt(stockLots.quantityRemaining, 0)))
          .orderBy(asc(stockLots.receivedAt), asc(stockLots.createdAt), asc(stockLots.id));
        let need = quantity;
        const plan = [];
        for (const lot of lots) {
          if (need === 0) break;
          const take = Math.min(need, lot.quantityRemaining);
          plan.push({ lotId: lot.id, lotCode: lot.lotCode, quantity: take, expiryDate: lot.expiryDate });
          need -= take;
        }
        lines.push({ productId, name: names.get(productId) ?? "", quantity, lots: plan, shortBy: need });
      }
    }

    return { orderId, status: order.status, stockState: order.stockState, planned: order.stockState === "reserved", lines };
  }

  // ── Daily sweep (cron) ───────────────────────────────────────────────────

  /**
   * Releases holds on orders that have waited too long for approval, then
   * emails admins one digest of anything that needs attention: products at
   * or under their low-stock threshold and lots expiring within 30 days.
   */
  async runDailySweep(now = new Date()) {
    const cutoff = new Date(now.getTime() - reservationDays() * DAY_MS);
    const stale = await this.db
      .select()
      .from(orders)
      .where(
        and(
          eq(orders.status, "pending_approval"),
          eq(orders.stockState, "reserved"),
          lte(orders.placedAt, cutoff),
        ),
      );
    for (const order of stale) {
      await this.db.transaction((tx) =>
        this.releaseForOrder(tx, order, null, `Released after ${reservationDays()} days awaiting approval`),
      );
    }

    const lowStock = (await this.listStock()).filter((p) => p.status === "published" && p.isLow);

    const expiryCutoff = new Date(now.getTime() + EXPIRY_WARNING_DAYS * DAY_MS).toISOString().slice(0, 10);
    const expiring = await this.db
      .select({
        lotCode: stockLots.lotCode,
        productName: products.name,
        remaining: stockLots.quantityRemaining,
        expiryDate: stockLots.expiryDate,
      })
      .from(stockLots)
      .innerJoin(products, eq(stockLots.productId, products.id))
      .where(
        and(
          gt(stockLots.quantityRemaining, 0),
          isNotNull(stockLots.expiryDate),
          lte(stockLots.expiryDate, expiryCutoff),
        ),
      )
      .orderBy(asc(stockLots.expiryDate));

    const summary = {
      releasedOrders: stale.map((o) => o.id),
      lowStock: lowStock.map((p) => ({ name: p.name, available: p.available, threshold: p.lowStockThreshold })),
      expiringLots: expiring.map((l) => ({ ...l, expiryDate: l.expiryDate! })),
    };

    if (summary.releasedOrders.length || summary.lowStock.length || summary.expiringLots.length) {
      const admins = await this.db
        .select({ email: staff.email })
        .from(staff)
        .where(and(eq(staff.isActive, true), inArray(staff.role, ["super_admin", "admin"])));
      const message = emails.inventoryDigest(summary);
      for (const a of admins) void this.email.send({ to: a.email, ...message });
      this.log.log(
        `inventory sweep: released ${summary.releasedOrders.length}, low ${summary.lowStock.length}, expiring ${summary.expiringLots.length}`,
      );
    }
    return summary;
  }

  // ── Shapes ───────────────────────────────────────────────────────────────

  private levels(p: typeof products.$inferSelect) {
    const available = p.stockQuantity - p.stockReserved;
    return {
      onHand: p.stockQuantity,
      reserved: p.stockReserved,
      available,
      lowStockThreshold: p.lowStockThreshold,
      isLow: available <= p.lowStockThreshold,
    };
  }

  private toLot(lot: typeof stockLots.$inferSelect) {
    return {
      id: lot.id,
      productId: lot.productId,
      lotCode: lot.lotCode,
      quantityReceived: lot.quantityReceived,
      quantityRemaining: lot.quantityRemaining,
      receivedAt: lot.receivedAt,
      expiryDate: lot.expiryDate,
      unitCost: lot.unitCostKobo !== null ? koboToNaira(lot.unitCostKobo) : null,
      vendorId: lot.vendorId,
      note: lot.note,
    };
  }
}
