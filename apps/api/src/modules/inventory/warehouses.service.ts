import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq, inArray, isNull, notInArray, sql } from 'drizzle-orm';
import { inventoryMovements, orders, orderItems, pickupCenters, products, warehouseStocks, warehouseMovements, staff, type Db, type Tx } from '@farmermarket/db';
import { DB } from '../../db/db.module';
import { componentDemand } from './inventory-stock';
import { changeWarehouseStock, lockWarehouseStock, requireWarehouse, unallocatedAvailable } from './warehouse-stock';
import type { AllocationInput, CountInput, TransferInput } from './inventory.dto';

@Injectable()
export class WarehousesService {
 constructor(@Inject(DB) private readonly db:Db){}
 overview(){return this.db.transaction(async tx=>{
  const locations=await tx.select().from(pickupCenters).orderBy(pickupCenters.name);
  const balances=await tx.select().from(warehouseStocks);
  const catalog=await tx.select().from(products).orderBy(products.name);
  const legacyOrders=await tx.select().from(orders).where(and(eq(orders.stockReserved,true),isNull(orders.stockWarehouseId),notInArray(orders.status,['delivered','cancelled','rejected'])));
  const lines=legacyOrders.length?await tx.select().from(orderItems).where(inArray(orderItems.orderId,legacyOrders.map(o=>o.id))):[];
  const reserved=componentDemand(lines);
  return {warehouses:locations,balances,unassigned:catalog.map(p=>({productId:p.id,name:p.name,unit:p.unit,available:p.stockQuantity-balances.filter(b=>b.productId===p.id).reduce((n,b)=>n+b.available,0),reserved:reserved.get(p.id)??0})),legacyOrders:legacyOrders.map(o=>({id:o.id,pickupCenterName:o.pickupCenterName,pickupCenterId:o.pickupCenterId,status:o.status,items:[...componentDemand(lines.filter(l=>l.orderId===o.id))].map(([productId,quantity])=>({productId,quantity}))}))};
 },{isolationLevel:'repeatable read'});}
 async history(warehouseId?:string,page=1){
  const filter=warehouseId?eq(warehouseMovements.warehouseId,warehouseId):undefined;
  const [total]=await this.db.select({count:sql<number>`count(*)::int`}).from(warehouseMovements).where(filter);
  const rows=await this.db.select({movement:warehouseMovements,actorName:staff.fullName}).from(warehouseMovements).leftJoin(staff,eq(warehouseMovements.actorStaffId,staff.id)).where(filter).orderBy(desc(warehouseMovements.createdAt),desc(warehouseMovements.id)).limit(50).offset((page-1)*50);
  return {items:rows.map(r=>({...r.movement,actorName:r.actorName})),total:total.count,page,pageSize:50};
 }
 private async replay(tx:Tx,key:string,input:AllocationInput|TransferInput|CountInput,actor:string,kind:string){
  const [old]=await tx.select().from(inventoryMovements).where(eq(inventoryMovements.eventKey,key));
  if(!old)return false;
  const entries=await tx.select().from(warehouseMovements).where(eq(warehouseMovements.inventoryMovementId,old.id));
  const source=entries.find(e=>e.warehouseId===input.warehouseId);
  const canonical=(v:Record<string,unknown>)=>JSON.stringify(Object.entries(v).sort(([a],[b])=>a.localeCompare(b)));
  if(!source?.requestSnapshot||canonical(source.requestSnapshot)!==canonical({...input,actor}))throw new ConflictException('This operation was already used for another warehouse action');
  const quantity=kind==='count'?('onHand' in input?input.onHand:0):('quantity' in input?input.quantity:0);
  if(old.productId!==input.productId||old.actorStaffId!==actor||old.kind!==kind||old.reason!==input.reason||(old.reference??'')!==input.reference||!source||source.kind!==kind||
    (kind==='count' ? source.availableAfter+source.reservedAfter!==quantity : Math.abs(source.availableAfter-source.availableBefore)!==quantity)||
    ('destinationId' in input&&!entries.some(e=>e.warehouseId===input.destinationId)))throw new ConflictException('This operation was already used for another warehouse action');
  return true;
 }
 async post(kind:'allocation'|'transfer'|'count',input:AllocationInput|TransferInput|CountInput,actor:string){return this.db.transaction(async tx=>{
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${input.operationId}))`);
  const [p]=await tx.select().from(products).where(eq(products.id,input.productId)).for('update');
  if(!p)throw new NotFoundException('Product not found');
  const key=`warehouse:${input.operationId}`;
  if(await this.replay(tx,key,input,actor,kind))return {replayed:true};
  const source=await requireWarehouse(tx,input.warehouseId,kind==='allocation');
  let delta=0,sourceDelta=0;
  if(kind==='allocation'&&'quantity' in input){const remaining=await unallocatedAvailable(tx,p);if(input.quantity>remaining)throw new BadRequestException(`Only ${remaining} unassigned units remain`);sourceDelta=input.quantity;}
  else if(kind==='transfer'&&'destinationId' in input){
   if(input.destinationId===source.id)throw new BadRequestException('Choose different warehouses');
   await requireWarehouse(tx,input.destinationId);sourceDelta=-input.quantity;
  }else if(kind==='count'&&'onHand' in input){
   const b=await lockWarehouseStock(tx,p.id,source.id);
   if(b.version!==input.expectedVersion)throw new ConflictException('Stock changed since this count started. Refresh and count again.');
   if(input.onHand<b.reserved)throw new BadRequestException(`Count cannot be below ${b.reserved} reserved units. Resolve the affected orders first.`);
   delta=input.onHand-b.reserved-b.available;sourceDelta=delta;
  }else throw new BadRequestException('Invalid warehouse action');
  const after=p.stockQuantity+delta;
  if(after<0||after>2147483647)throw new BadRequestException('Stock exceeds supported quantity');
  const [movement]=await tx.insert(inventoryMovements).values({productId:p.id,productName:p.name,kind,availableDelta:delta,availableBefore:p.stockQuantity,availableAfter:after,warehouseId:source.id,reason:input.reason,reference:input.reference||null,actorStaffId:actor,eventKey:key}).returning();
  const context={kind,reason:input.reason,reference:input.reference||null,actorStaffId:actor,operationId:input.operationId,inventoryMovementId:movement.id,requestSnapshot:{...input,actor}};
  await changeWarehouseStock(tx,p,source.id,sourceDelta,0,{...context,eventKey:`${key}:source`});
  if(kind==='transfer'&&'destinationId' in input)await changeWarehouseStock(tx,p,input.destinationId,input.quantity,0,{...context,eventKey:`${key}:destination`});
  if(delta)await tx.update(products).set({stockQuantity:after,updatedAt:new Date()}).where(eq(products.id,p.id));
  return {movementId:movement.id,replayed:false};
 });}

 /** Assign reservations that predate warehouse tracking, without consuming available stock again. */
 async assignLegacyOrder(id:string,warehouseId:string,actor:string){return this.db.transaction(async tx=>{
  const [order]=await tx.select().from(orders).where(eq(orders.id,id)).for('update');
  if(!order)throw new NotFoundException('Order not found');
  if(order.stockWarehouseId){if(order.stockWarehouseId===warehouseId)return {assigned:true};throw new ConflictException('Order already has a stock warehouse');}
  if(!order.stockReserved||['delivered','rejected','cancelled'].includes(order.status))throw new BadRequestException('Only open reserved legacy orders can be assigned');
  if(order.pickupCenterId&&order.pickupCenterId!==warehouseId)throw new BadRequestException('Assign the order to its selected pickup location');
  const lines=await tx.select().from(orderItems).where(eq(orderItems.orderId,id));
  const demand=componentDemand(lines);
  const rows=demand.size?await tx.select().from(products).where(inArray(products.id,[...demand.keys()])).orderBy(products.id).for('update'):[];
  if(!demand.size||rows.length!==demand.size)throw new BadRequestException('Resolve missing order products before assigning the reservation');
  await requireWarehouse(tx,warehouseId);
  for(const p of rows){const quantity=demand.get(p.id)!;const [m]=await tx.insert(inventoryMovements).values({productId:p.id,productName:p.name,kind:'allocation',availableDelta:0,availableBefore:p.stockQuantity,availableAfter:p.stockQuantity,reason:'Assign existing order reservation to pickup warehouse',actorStaffId:actor,warehouseId,orderId:id,eventKey:`legacy-warehouse:${id}:${p.id}`}).returning();await changeWarehouseStock(tx,p,warehouseId,0,quantity,{kind:'allocation',reason:m.reason,actorStaffId:actor,orderId:id,inventoryMovementId:m.id,eventKey:`legacy-warehouse:${id}:${p.id}`});}
  await tx.update(orders).set({stockWarehouseId:warehouseId,updatedAt:new Date()}).where(eq(orders.id,id));return {assigned:true};
 });}
}
