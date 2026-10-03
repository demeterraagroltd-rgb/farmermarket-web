import { BadRequestException } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { pickupCenters, warehouseStocks, warehouseMovements, products, type Tx } from '@farmermarket/db';

export async function requireWarehouse(tx:Tx,id:string,active=true) {
  const [w]=await tx.select().from(pickupCenters).where(eq(pickupCenters.id,id)).for('share');
  if(!w || (active&&!w.isActive))throw new BadRequestException('Choose an active pickup warehouse');
  return w;
}

/** All callers lock the product first, in product-ID order, before location balances. */
export async function lockWarehouseStock(tx:Tx,productId:string,warehouseId:string) {
  await tx.insert(warehouseStocks).values({productId,warehouseId}).onConflictDoNothing();
  const [balance]=await tx.select().from(warehouseStocks).where(and(eq(warehouseStocks.productId,productId),eq(warehouseStocks.warehouseId,warehouseId))).for('update');
  return balance;
}

export async function unallocatedAvailable(tx:Tx,p:typeof products.$inferSelect) {
  const [r]=await tx.select({allocated:sql<number>`coalesce(sum(${warehouseStocks.available}),0)::int`}).from(warehouseStocks).where(eq(warehouseStocks.productId,p.id));
  const available=p.stockQuantity-r.allocated;
  if(available<0)throw new BadRequestException('Inventory balances disagree. Resolve the warehouse allocation before posting.');
  return available;
}

type Movement = Pick<typeof warehouseMovements.$inferInsert,'kind'|'eventKey'|'reason'|'reference'|'actorStaffId'|'orderId'|'inventoryMovementId'|'operationId'|'requestSnapshot'>;
export async function changeWarehouseStock(tx:Tx,p:typeof products.$inferSelect,warehouseId:string,availableDelta:number,reservedDelta:number,movement:Movement) {
  const w=await requireWarehouse(tx,warehouseId,false);
  const before=await lockWarehouseStock(tx,p.id,warehouseId);
  const available=before.available+availableDelta,reserved=before.reserved+reservedDelta;
  if(available<0)throw new BadRequestException(`Not enough stock for ${p.name} at ${w.name}. Available: ${before.available}`);
  if(reserved<0)throw new BadRequestException('Warehouse reservation balance is inconsistent');
  if(available+reserved>2147483647)throw new BadRequestException('Warehouse stock exceeds the supported quantity');
  await tx.update(warehouseStocks).set({available,reserved,version:before.version+1,updatedAt:new Date()}).where(eq(warehouseStocks.id,before.id));
  const [entry]=await tx.insert(warehouseMovements).values({...movement,productId:p.id,productName:p.name,unit:p.unit,warehouseId,warehouseName:w.name,availableBefore:before.available,availableAfter:available,reservedBefore:before.reserved,reservedAfter:reserved}).returning();
  return entry;
}
