import { BadRequestException } from "@nestjs/common";
import { eq, inArray, sql } from "drizzle-orm";
import { bundles, bundleItems, products, orders, orderItems, inventoryMovements, type Tx } from "@farmermarket/db";
import { describeBundle } from "../catalog/bundle-pricing";
import { componentDemand } from "../inventory/inventory-stock";
import type { CreateOrderInput } from "./dto/create-order.dto";
import { changeWarehouseStock, requireWarehouse } from '../inventory/warehouse-stock';

/** Lock definitions first, then all shared product stock in a consistent order. */
export async function reserveOrderLines(tx: Tx, input: CreateOrderInput["items"], warehouseId:string) {
  const bundleIds = [...new Set(input.flatMap((i) => i.bundleId ? [i.bundleId] : []))];
  const definitions = bundleIds.length ? await tx.select().from(bundles).where(inArray(bundles.id, bundleIds)).orderBy(bundles.id).for("share") : [];
  const components = bundleIds.length ? await tx.select().from(bundleItems).where(inArray(bundleItems.bundleId, bundleIds)) : [];
  const productIds = [...new Set([...input.flatMap((i) => i.productId ? [i.productId] : []), ...components.map((i) => i.productId)])];
  const productRows = productIds.length ? await tx.select().from(products).where(inArray(products.id, productIds)).orderBy(products.id).for("update") : [];
  const byId = new Map(productRows.map((p) => [p.id, p]));
  await requireWarehouse(tx,warehouseId);
  const demand = new Map<string, number>();
  const addDemand = (id: string, quantity: number) => demand.set(id, (demand.get(id) ?? 0) + quantity);
  const lines: Omit<typeof orderItems.$inferInsert, "orderId">[] = input.map((item) => {
    if (!!item.productId === !!item.bundleId) throw new BadRequestException("Choose exactly one product or bundle");
    if (item.productId) {
      const product = byId.get(item.productId);
      if (!product || product.status !== "published" || !product.isAvailable) throw new BadRequestException("That product is not available");
      addDemand(product.id, item.quantity);
      return { productId: product.id, name: product.name, imageUrl: product.imageUrl,
        quantity: item.quantity, unitPriceKobo: product.discountPriceKobo ?? product.priceKobo };
    }
    const bundle = definitions.find((b) => b.id === item.bundleId);
    if (!bundle || !bundle.active) throw new BadRequestException("That bundle is not available");
    const included = components.filter((i) => i.bundleId === bundle.id).map((i) => ({ product: byId.get(i.productId)!, quantity: i.quantity }));
    const view = describeBundle(bundle, included);
    if (!view.isAvailable) throw new BadRequestException(`${bundle.name} is not available`);
    for (const i of included) addDemand(i.product.id, i.quantity * item.quantity);
    return { bundleId: bundle.id, name: bundle.name, imageUrl: bundle.imageUrl!, quantity: item.quantity, unitPriceKobo: bundle.bundlePriceKobo!,
      components: included.map(({ product, quantity }) => ({ productId: product.id, name: product.name,
        imageUrl: product.imageUrl, unit: product.unit, quantity, unitPriceKobo: (product.discountPriceKobo ?? product.priceKobo).toString() })) };
  });
  // Aggregate overlapping products across bundles and individual lines before deducting.
  for (const [id, quantity] of demand) {
    const product = byId.get(id)!;
    if (product.stockQuantity < quantity) throw new BadRequestException(`Not enough stock for ${product.name}. Available: ${product.stockQuantity}`);
    await tx.update(products).set({ stockQuantity: product.stockQuantity - quantity, updatedAt: new Date() }).where(eq(products.id, id));
  }
  return lines;
}

/** Uses purchase snapshots, so later bundle edits never alter a stock release. Caller locks the order. */
export async function releaseOrderStock(tx: Tx, order: typeof orders.$inferSelect, actorStaffId?: string) {
  if (!order.stockReserved) return;
  const lines = await tx.select().from(orderItems).where(eq(orderItems.orderId, order.id));
  const quantities = componentDemand(lines);
  for (const [id, quantity] of [...quantities].sort(([a], [b]) => a.localeCompare(b))) {
    const [p] = await tx.update(products).set({ stockQuantity: sql`${products.stockQuantity} + ${quantity}`, updatedAt: new Date() }).where(eq(products.id, id)).returning();
    if(order.stockWarehouseId)await changeWarehouseStock(tx,p,order.stockWarehouseId,quantity,-quantity,{kind:'release',reason:'Order rejected or cancelled',actorStaffId,orderId:order.id,eventKey:`release:${order.id}:${id}`});
    await tx.insert(inventoryMovements).values({ productId: id, productName: p.name, kind: "release",
      availableDelta: quantity, reservedDelta: -quantity, availableBefore: p.stockQuantity - quantity,
      availableAfter: p.stockQuantity, actorStaffId, warehouseId:order.stockWarehouseId, reason: "Order rejected or cancelled", orderId: order.id,
      eventKey: `release:${order.id}:${id}` });
  }
  await tx.update(orders).set({ stockReserved: false }).where(eq(orders.id, order.id));
}
