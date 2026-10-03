import { eq, inArray } from "drizzle-orm";
import { products, inventoryMovements, type Tx, type orderItems } from "@farmermarket/db";
import { changeWarehouseStock } from './warehouse-stock';

export function componentDemand(lines: Pick<typeof orderItems.$inferSelect, "productId" | "bundleId" | "components" | "quantity">[]) {
  const quantities = new Map<string, number>();
  for (const line of lines) {
    if (line.bundleId) for (const item of line.components) quantities.set(item.productId, (quantities.get(item.productId) ?? 0) + item.quantity * line.quantity);
    else if (line.productId) quantities.set(line.productId, (quantities.get(line.productId) ?? 0) + line.quantity);
  }
  return quantities;
}

/** Product locks are held by checkout until this snapshot is recorded. */
export async function recordOrderReservation(tx: Tx, orderId: string, lines: (typeof orderItems.$inferSelect)[], warehouseId:string) {
  const demand = componentDemand(lines);
  const rows = await tx.select().from(products).where(inArray(products.id, [...demand.keys()]));
  const movements=rows.length?await tx.insert(inventoryMovements).values(rows.map((p) => ({ productId: p.id, productName: p.name,
    kind: "reservation", availableDelta: -demand.get(p.id)!, reservedDelta: demand.get(p.id)!,
    availableBefore: p.stockQuantity + demand.get(p.id)!, availableAfter: p.stockQuantity,
    reason: "Reserved at checkout", orderId, warehouseId, eventKey: `reserve:${orderId}:${p.id}` }))).returning():[];
  for(const p of rows){const quantity=demand.get(p.id)!;await changeWarehouseStock(tx,p,warehouseId,-quantity,quantity,{kind:'reservation',reason:'Reserved at checkout',orderId,eventKey:`reserve:${orderId}:${p.id}`,inventoryMovementId:movements.find(m=>m.productId===p.id)!.id});}
}

export async function recordOrderFulfilment(tx: Tx, orderId: string, lines: (typeof orderItems.$inferSelect)[], actorStaffId?: string,warehouseId?:string|null) {
  for (const [id, quantity] of [...componentDemand(lines)].sort(([a], [b]) => a.localeCompare(b))) {
    const [p] = await tx.select().from(products).where(eq(products.id, id)).for("update");
    if(warehouseId)await changeWarehouseStock(tx,p,warehouseId,0,-quantity,{kind:'fulfilment',reason:'Order delivered / collected',orderId,actorStaffId,eventKey:`fulfil:${orderId}:${id}`});
    await tx.insert(inventoryMovements).values({ productId: id, productName: p.name, kind: "fulfilment",
      availableDelta: 0, reservedDelta: -quantity, availableBefore: p.stockQuantity, availableAfter: p.stockQuantity,
      reason: "Order delivered / collected", orderId, actorStaffId, warehouseId, eventKey: `fulfil:${orderId}:${id}` });
  }
}
