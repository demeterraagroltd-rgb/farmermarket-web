import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { and, desc, eq, inArray, notInArray, or, sql } from "drizzle-orm";
import { inventoryCostLots,inventoryCostAssignments,inventoryCostEntries,inventoryMovements,products,orders,orderItems,auditLogs,type Db } from "@farmermarket/db";
import { koboToNaira,nairaToKobo } from "@farmermarket/core";
import { DB } from "../../db/db.module";
import { componentDemand } from "./inventory-stock";
import type { AuthenticatedStaff } from "../../common/decorators/current-staff.decorator";

@Injectable()
export class ValuationService {
 constructor(@Inject(DB) private readonly db:Db){}
 overview(){return this.db.transaction(async tx=>{
  const catalog=await tx.select().from(products).orderBy(products.name);
  const lots=await tx.select().from(inventoryCostLots).orderBy(inventoryCostLots.sequence);
  const reservedLines=await tx.select({line:orderItems}).from(orderItems).innerJoin(orders,eq(orderItems.orderId,orders.id)).where(and(eq(orders.stockReserved,true),notInArray(orders.status,["delivered","cancelled","rejected"])));
  const demand=componentDemand(reservedLines.map(r=>r.line));
  let knownValue=0n,unknownUnits=0,mismatches=0;
  const rows=catalog.map(p=>{
   const stockLots=lots.filter(l=>l.productId===p.id&&l.remainingQuantity>0);
   const tracked=stockLots.reduce((sum,l)=>sum+l.remainingQuantity,0),onHand=p.stockQuantity+(demand.get(p.id)??0);
   const value=stockLots.reduce((sum,l)=>sum+(l.unitCostKobo===null?0n:l.unitCostKobo*BigInt(l.remainingQuantity)),0n);
   const unknown=stockLots.filter(l=>l.unitCostKobo===null).reduce((sum,l)=>sum+l.remainingQuantity,0)+Math.max(0,onHand-tracked);
   const matches=tracked===onHand;knownValue+=value;unknownUnits+=unknown;if(!matches)mismatches++;
   return {id:p.id,name:p.name,unit:p.unit,sku:p.sku,available:p.stockQuantity,reserved:demand.get(p.id)??0,onHand,tracked,unknownUnits:unknown,knownValue:koboToNaira(value),complete:matches&&unknown===0,
    lots:stockLots.map(l=>({...l,unitCost:l.unitCostKobo===null?null:koboToNaira(l.unitCostKobo),value:l.unitCostKobo===null?null:koboToNaira(l.unitCostKobo*BigInt(l.remainingQuantity))}))};
  });
  return {method:"FIFO across all pickup warehouses",knownValue:koboToNaira(knownValue),unknownUnits,mismatches,complete:unknownUnits===0&&mismatches===0,products:rows};
 },{isolationLevel:"repeatable read"});}
 async assign(lotId:string,input:{unitCostNaira:number;version:number;reason:string;operationId:string},actor:AuthenticatedStaff){
  if(actor.role!=="super_admin")throw new ForbiddenException("Only a super admin can assign inventory costs");
  return this.db.transaction(async tx=>{
   await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${input.operationId}))`);
   const cost=nairaToKobo(input.unitCostNaira);
   const [existing]=await tx.select().from(inventoryCostAssignments).where(eq(inventoryCostAssignments.operationId,input.operationId));
   if(existing){if(existing.lotId!==lotId||existing.unitCostKobo!==cost||existing.reason!==input.reason||existing.actorStaffId!==actor.staffId)throw new ConflictException("Operation was already used for another cost assignment");return existing;}
   const [header]=await tx.select().from(inventoryCostLots).where(eq(inventoryCostLots.id,lotId));
   if(!header)throw new NotFoundException("Cost lot not found");
   await tx.select().from(products).where(eq(products.id,header.productId)).for("update");
   const [lot]=await tx.select().from(inventoryCostLots).where(eq(inventoryCostLots.id,lotId)).for("update");
   if(lot.version!==input.version)throw new ConflictException("Stock changed. Refresh before assigning this cost.");
   if(lot.unitCostKobo!==null)throw new BadRequestException("Known costs cannot be overwritten");
   if(lot.remainingQuantity===0)throw new BadRequestException("This lot has no remaining stock; historical costs cannot be rewritten");
   const [assignment]=await tx.insert(inventoryCostAssignments).values({lotId,unitCostKobo:cost,reason:input.reason,actorStaffId:actor.staffId,operationId:input.operationId}).returning();
   await tx.update(inventoryCostLots).set({unitCostKobo:cost,version:lot.version+1}).where(eq(inventoryCostLots.id,lotId));
   await tx.insert(auditLogs).values({actorStaffId:actor.staffId,action:"inventory.cost_assigned",targetType:"inventory_cost_lot",targetId:lotId,metadata:{reason:input.reason,unitCostKobo:cost.toString(),remainingQuantity:lot.remainingQuantity}});
   return assignment;
  });
 }
 report(from:string,to:string){return this.db.transaction(async tx=>{
  const start=new Date(`${from}T00:00:00Z`),end=new Date(`${to}T00:00:00Z`);end.setUTCDate(end.getUTCDate()+1);
  const selected=await tx.select().from(orders).where(and(eq(orders.status,"delivered"),sql`coalesce(${orders.deliveredAt},${orders.createdAt}) >= ${start} AND coalesce(${orders.deliveredAt},${orders.createdAt}) < ${end}`)).orderBy(desc(orders.deliveredAt));
  const ids=selected.map(o=>o.id);
  const entries=await tx.select({entry:inventoryCostEntries,movement:inventoryMovements}).from(inventoryCostEntries).innerJoin(inventoryMovements,eq(inventoryCostEntries.movementId,inventoryMovements.id))
   .where(or(and(eq(inventoryCostEntries.kind,"cogs"),ids.length?inArray(inventoryMovements.orderId,ids):sql`false`),and(eq(inventoryCostEntries.kind,"stock_loss"),sql`${inventoryMovements.createdAt}>=${start} AND ${inventoryMovements.createdAt}<${end}`)));
  const lines=ids.length?await tx.select().from(orderItems).where(inArray(orderItems.orderId,ids)):[];
  let revenue=0n,knownCogs=0n,missingUnits=0;
  const orderRows=selected.map(o=>{
   const demand=componentDemand(lines.filter(l=>l.orderId===o.id));
   const related=entries.filter(e=>e.movement.orderId===o.id&&e.entry.kind==="cogs");
   const known=related.reduce((sum,e)=>sum+(e.entry.unitCostKobo===null?0n:e.entry.unitCostKobo*BigInt(e.entry.quantity)),0n);
   let missing=0;let exact=demand.size>0;
   for(const [id,quantity] of demand){const items=related.filter(e=>e.movement.productId===id);const recorded=items.reduce((sum,e)=>sum+e.entry.quantity,0);if(recorded!==quantity)exact=false;missing+=Math.max(0,quantity-recorded)+items.filter(e=>e.entry.unitCostKobo===null).reduce((sum,e)=>sum+e.entry.quantity,0);}
   if(related.some(e=>!demand.has(e.movement.productId)))exact=false;
   const complete=exact&&missing===0;revenue+=o.subtotalKobo;knownCogs+=known;missingUnits+=missing;
   return {id:o.id,deliveredAt:o.deliveredAt??o.createdAt,warehouseName:o.pickupCenterName,revenue:koboToNaira(o.subtotalKobo),knownCogs:koboToNaira(known),missingUnits:missing,complete,grossMargin:complete?koboToNaira(o.subtotalKobo-known):null};
  });
  const losses=entries.filter(e=>e.entry.kind==="stock_loss"&&e.movement.createdAt>=start&&e.movement.createdAt<end);
  const knownLoss=losses.reduce((sum,e)=>sum+(e.entry.unitCostKobo===null?0n:e.entry.unitCostKobo*BigInt(e.entry.quantity)),0n);
  const unknownLossUnits=losses.filter(e=>e.entry.unitCostKobo===null).reduce((sum,e)=>sum+e.entry.quantity,0);
  const complete=orderRows.every(o=>o.complete);
  return {from,to,orders:orderRows,revenue:koboToNaira(revenue),knownCogs:koboToNaira(knownCogs),missingUnits,complete,grossMargin:complete?koboToNaira(revenue-knownCogs):null,knownStockLoss:koboToNaira(knownLoss),unknownLossUnits};
 },{isolationLevel:"repeatable read"});}
}
