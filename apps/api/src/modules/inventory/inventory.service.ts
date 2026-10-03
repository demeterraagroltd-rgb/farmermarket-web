import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { and, desc, eq, notInArray, sql } from "drizzle-orm";
import { products, orders, orderItems, inventoryMovements, staff, auditLogs, type Db } from "@farmermarket/db";
import { DB } from "../../db/db.module";
import { readBundles } from "../catalog/bundles.service";
import { componentDemand } from "./inventory-stock";
import type { StockMovementInput } from "./inventory.dto";
import { changeWarehouseStock, requireWarehouse, unallocatedAvailable } from './warehouse-stock';

@Injectable()
export class InventoryService {
  constructor(@Inject(DB) private readonly db: Db) {}

  overview() {
    return this.db.transaction(async (tx) => {
      const rows = await tx.select().from(products).orderBy(products.name);
      const reservedLines = await tx.select({ line: orderItems }).from(orderItems).innerJoin(orders, eq(orderItems.orderId, orders.id))
        .where(and(eq(orders.stockReserved, true), notInArray(orders.status, ["delivered", "cancelled", "rejected"])));
      const reserved = componentDemand(reservedLines.map((r) => r.line));
      const productRows = rows.map((p) => ({ id: p.id, name: p.name, imageUrl: p.imageUrl, sku: p.sku, unit: p.unit, status: p.status,
        available: p.stockQuantity, reserved: reserved.get(p.id) ?? 0, onHand: p.stockQuantity + (reserved.get(p.id) ?? 0),
        lowStockThreshold: p.lowStockThreshold, stockStatus: p.stockQuantity === 0 ? "out_of_stock" : p.stockQuantity <= p.lowStockThreshold ? "low_stock" : "in_stock" }));
      return { products: productRows, bundles: (await readBundles(tx)).map((b) => ({ id: b.id, name: b.name, active: b.active,
        availableQuantity: b.availableQuantity, missingProducts: b.missingProducts, limitingProducts: b.items.filter((i) =>
          Math.floor((i.status === "published" && i.isAvailable ? i.stockQuantity : 0) / i.quantity) === b.availableQuantity).map((i) => i.name) })),
        summary: { products: rows.length, lowStock: productRows.filter((p) => p.stockStatus === "low_stock").length,
          outOfStock: productRows.filter((p) => p.stockStatus === "out_of_stock").length,
          reservedUnits: productRows.reduce((n, p) => n + p.reserved, 0) } };
    }, { isolationLevel: "repeatable read" });
  }

  async history(productId?: string, page = 1) {
    const where = productId ? eq(inventoryMovements.productId, productId) : undefined;
    const [{ count }] = await this.db.select({ count: sql<number>`count(*)::int` }).from(inventoryMovements).where(where);
    const rows = await this.db.select({ movement: inventoryMovements, actorName: staff.fullName, actorEmail: staff.email })
      .from(inventoryMovements).leftJoin(staff, eq(inventoryMovements.actorStaffId, staff.id)).where(where)
      .orderBy(desc(inventoryMovements.createdAt), desc(inventoryMovements.id)).limit(50).offset((page - 1) * 50);
    return { items: rows.map(({ movement, actorName, actorEmail }) => ({ ...movement, actorName, actorEmail })), page, total: count, pageSize: 50 };
  }

  async move(productId: string, input: StockMovementInput, actorStaffId: string) {
    return this.db.transaction(async (tx) => {
      // Serialize retries even if an operation ID is accidentally reused for another product.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${input.operationId}))`);
      const [p] = await tx.select().from(products).where(eq(products.id, productId)).for("update");
      if (!p) throw new NotFoundException("Product not found");
      const key = `manual:${input.operationId}`;
      const [existing] = await tx.select().from(inventoryMovements).where(eq(inventoryMovements.eventKey, key));
      if (existing) {
        if (existing.productId !== productId || existing.actorStaffId !== actorStaffId || existing.warehouseId !== (input.warehouseId??null) || existing.kind !== input.kind || existing.availableDelta !== input.quantity || existing.reason !== input.reason || (existing.reference ?? "") !== (input.reference ?? "")) throw new ConflictException("This operation was already used for a different movement");
        return existing;
      }
      const after = p.stockQuantity + input.quantity;
      if (after < 0) throw new BadRequestException(`Only ${p.stockQuantity} units are available. Reserved stock cannot be removed.`);
      if (after > 2147483647) throw new BadRequestException("Stock exceeds the supported quantity");
      if(input.warehouseId)await requireWarehouse(tx,input.warehouseId,input.kind==='receive');
      else if(await unallocatedAvailable(tx,p)+input.quantity<0)throw new BadRequestException('Only unassigned stock can be adjusted without choosing a warehouse');
      const [movement] = await tx.insert(inventoryMovements).values({ productId, productName: p.name, kind: input.kind,
        availableDelta: input.quantity, availableBefore: p.stockQuantity, availableAfter: after, reason: input.reason,
        reference: input.reference || null, warehouseId:input.warehouseId, actorStaffId, eventKey: key }).returning();
      if(input.warehouseId)await changeWarehouseStock(tx,p,input.warehouseId,input.quantity,0,{kind:input.kind,eventKey:key,reason:input.reason,reference:input.reference||null,actorStaffId,operationId:input.operationId,inventoryMovementId:movement.id});
      await tx.update(products).set({ stockQuantity: after, updatedAt: new Date() }).where(eq(products.id, productId));
      return movement;
    });
  }

  async threshold(productId: string, lowStockThreshold: number, actorStaffId: string) {
    return this.db.transaction(async (tx) => {
      const [p] = await tx.select().from(products).where(eq(products.id, productId)).for("update");
      if (!p) throw new NotFoundException("Product not found");
      const [updated] = await tx.update(products).set({ lowStockThreshold, updatedAt: new Date() }).where(eq(products.id, productId)).returning();
      await tx.insert(auditLogs).values({ actorStaffId, action: "inventory.threshold_changed", targetType: "product", targetId: productId,
        metadata: { before: p.lowStockThreshold, after: lowStockThreshold } });
      return { id: updated.id, lowStockThreshold: updated.lowStockThreshold };
    });
  }
}
