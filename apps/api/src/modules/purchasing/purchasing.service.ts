import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { vendors, products, pickupCenters, purchaseOrders, purchaseOrderLines, goodsReceipts, goodsReceiptLines, inventoryMovements, auditLogs, type Db, type Tx } from "@farmermarket/db";
import { koboToNaira, nairaToKobo } from "@farmermarket/core";
import { DB } from "../../db/db.module";
import type { AuthenticatedStaff } from "../../common/decorators/current-staff.decorator";
import { changeWarehouseStock } from '../inventory/warehouse-stock';
import type { PurchaseInput, ReceiptInput, SupplierInput, TransitionInput } from "./purchasing.dto";

const number = (prefix:string, n:number) => `${prefix}-${String(n).padStart(6,"0")}`;
@Injectable()
export class PurchasingService {
  constructor(@Inject(DB) private readonly db:Db) {}
  suppliers() {return this.db.select().from(vendors).orderBy(vendors.name);}
  async saveSupplier(input:SupplierInput, actor:AuthenticatedStaff, id?:string) {
    return this.db.transaction(async tx => {
      const [row] = id ? await tx.update(vendors).set({...input,updatedAt:new Date()}).where(eq(vendors.id,id)).returning() : await tx.insert(vendors).values(input).returning();
      if(!row) throw new NotFoundException("Supplier not found");
      await this.audit(tx,actor,"supplier.saved",row.id,{isActive:row.isActive}); return row;
    });
  }
  async list() {
    const rows = await this.db.select().from(purchaseOrders).orderBy(desc(purchaseOrders.createdAt));
    const lines = rows.length ? await this.db.select().from(purchaseOrderLines).where(inArray(purchaseOrderLines.purchaseOrderId,rows.map(p => p.id))) : [];
    return rows.map(p => ({...p,number:number("PO",p.sequence),total:koboToNaira(lines.filter(l => l.purchaseOrderId===p.id).reduce((sum,l) => sum+l.unitCostKobo*BigInt(l.quantity),0n))}));
  }
  async detail(id:string, source:Db|Tx=this.db) {
    const [po] = await source.select().from(purchaseOrders).where(eq(purchaseOrders.id,id));
    if(!po) throw new NotFoundException("Purchase order not found");
    const lines = await source.select().from(purchaseOrderLines).where(eq(purchaseOrderLines.purchaseOrderId,id));
    const receipts = await source.select().from(goodsReceipts).where(eq(goodsReceipts.purchaseOrderId,id)).orderBy(desc(goodsReceipts.createdAt));
    const receiptLines = receipts.length ? await source.select().from(goodsReceiptLines).where(inArray(goodsReceiptLines.receiptId,receipts.map(r => r.id))) : [];
    return {...po,number:number("PO",po.sequence),total:koboToNaira(lines.reduce((sum,l) => sum+l.unitCostKobo*BigInt(l.quantity),0n)),
      lines:lines.map(l => {const related=receiptLines.filter(r => r.purchaseOrderLineId===l.id); const received=related.reduce((sum,r)=>sum+r.accepted,0);return {...l,unitCost:koboToNaira(l.unitCostKobo),received,rejected:related.reduce((sum,r)=>sum+r.rejected,0),remaining:l.quantity-received};}),
      receipts:receipts.map(r => ({id:r.id,number:number("GRN",r.sequence),deliveryReference:r.deliveryReference,notes:r.notes,receivedBy:r.receivedBy,createdAt:r.createdAt,lines:receiptLines.filter(l => l.receiptId===r.id)}))};
  }
  async create(input:PurchaseInput, actor:AuthenticatedStaff) {
    return this.db.transaction(async tx => {
      const [supplier] = await tx.select().from(vendors).where(eq(vendors.id,input.supplierId)).for("share");
      if(!supplier?.isActive) throw new BadRequestException("Choose an active supplier");
      const [warehouse] = await tx.select().from(pickupCenters).where(eq(pickupCenters.id,input.warehouseId)).for("share");
      if(!warehouse?.isActive) throw new BadRequestException("Choose an active pickup location as the warehouse");
      const rows = await tx.select().from(products).where(inArray(products.id,input.lines.map(l=>l.productId))).orderBy(products.id).for("share");
      if(rows.length!==input.lines.length) throw new BadRequestException("A product no longer exists");
      const [po] = await tx.insert(purchaseOrders).values({supplierId:supplier.id,supplierName:supplier.name,warehouseId:warehouse.id,warehouseName:warehouse.name,notes:input.notes,createdBy:actor.staffId}).returning();
      await tx.insert(purchaseOrderLines).values(input.lines.map(l => {const p=rows.find(p=>p.id===l.productId)!;return {purchaseOrderId:po.id,productId:p.id,productName:p.name,unit:p.unit,quantity:l.quantity,unitCostKobo:nairaToKobo(l.unitCostNaira)};}));
      await this.audit(tx,actor,"purchase_order.created",po.id,{});return this.detail(po.id,tx);
    });
  }
  async transition(id:string, input:TransitionInput, actor:AuthenticatedStaff) {
    return this.db.transaction(async tx => {
      const [po] = await tx.select().from(purchaseOrders).where(eq(purchaseOrders.id,id)).for("update");
      if(!po) throw new NotFoundException("Purchase order not found");
      if(po.version!==input.version) throw new ConflictException("Purchase order changed. Refresh before continuing.");
      if(["submit","approve"].includes(input.action)) {
        const [warehouse]=await tx.select().from(pickupCenters).where(eq(pickupCenters.id,po.warehouseId)).for("share");
        if(!warehouse?.isActive) throw new BadRequestException("Pickup warehouse is inactive");
      }
      let status:string;
      if(input.action==="submit") {
        if(po.createdBy!==actor.staffId) throw new ForbiddenException("Only the preparer can submit this draft");
        if(po.status!=="draft") throw new BadRequestException("Only drafts can be submitted");
        const [supplier] = await tx.select().from(vendors).where(eq(vendors.id,po.supplierId)).for("share");
        if(!supplier?.isActive) throw new BadRequestException("Supplier is inactive"); status="submitted";
      } else if(input.action==="approve" || input.action==="return") {
        if(actor.role!=="super_admin") throw new ForbiddenException("Only a super admin can approve or return purchase orders");
        if(po.status!=="submitted") throw new BadRequestException("Only submitted orders can be reviewed");
        if(input.action==="approve" && po.createdBy===actor.staffId) throw new ForbiddenException("Another super admin must approve your purchase order");
        if(input.action==="return" && input.reason.length<3) throw new BadRequestException("Provide a reason for returning the order");
        if(input.action==="approve") {const [supplier]=await tx.select().from(vendors).where(eq(vendors.id,po.supplierId)).for("share");if(!supplier?.isActive) throw new BadRequestException("Supplier is inactive");}
        status=input.action==="approve"?"approved":"draft";
      } else {
        if(input.reason.length<3) throw new BadRequestException("Provide a reason");
        if(input.action==="cancel") {if(!["draft","submitted"].includes(po.status)) throw new BadRequestException("Received or approved orders must be closed instead");status="cancelled";}
        else {if(actor.role!=="super_admin") throw new ForbiddenException("Only a super admin can close an approved purchase order");if(!["approved","partially_received","fully_received"].includes(po.status)) throw new BadRequestException("Order cannot be closed");status="closed";}
      }
      await tx.update(purchaseOrders).set({status,version:po.version+1,updatedAt:new Date(),
        ...(input.action==="approve"?{approvedBy:actor.staffId,approvedAt:new Date()}:{}),
        ...(["close","cancel"].includes(input.action)?{closedReason:input.reason}:{})}).where(eq(purchaseOrders.id,id));
      await this.audit(tx,actor,`purchase_order.${input.action}`,id,{reason:input.reason,from:po.status,to:status});return this.detail(id,tx);
    });
  }
  async updateDraft(id:string,input:PurchaseInput & {version:number},actor:AuthenticatedStaff) {
    return this.db.transaction(async tx => {
      const [po]=await tx.select().from(purchaseOrders).where(eq(purchaseOrders.id,id)).for("update");
      if(!po) throw new NotFoundException("Purchase order not found");
      if(po.status!=="draft") throw new BadRequestException("Only drafts can be edited");
      if(po.createdBy!==actor.staffId) throw new ForbiddenException("Only the preparer can edit this draft");
      if(po.version!==input.version) throw new ConflictException("Purchase order changed. Refresh before editing.");
      const [supplier]=await tx.select().from(vendors).where(eq(vendors.id,input.supplierId)).for("share");
      const [warehouse]=await tx.select().from(pickupCenters).where(eq(pickupCenters.id,input.warehouseId)).for("share");
      if(!supplier?.isActive || !warehouse?.isActive) throw new BadRequestException("Choose an active supplier and pickup warehouse");
      const rows=await tx.select().from(products).where(inArray(products.id,input.lines.map(l=>l.productId))).orderBy(products.id).for("share");
      if(rows.length!==input.lines.length) throw new BadRequestException("A product no longer exists");
      await tx.delete(purchaseOrderLines).where(eq(purchaseOrderLines.purchaseOrderId,id));
      await tx.insert(purchaseOrderLines).values(input.lines.map(l=>{const p=rows.find(p=>p.id===l.productId)!;return {purchaseOrderId:id,productId:p.id,productName:p.name,unit:p.unit,quantity:l.quantity,unitCostKobo:nairaToKobo(l.unitCostNaira)};}));
      await tx.update(purchaseOrders).set({supplierId:supplier.id,supplierName:supplier.name,warehouseId:warehouse.id,warehouseName:warehouse.name,notes:input.notes,version:po.version+1,updatedAt:new Date()}).where(eq(purchaseOrders.id,id));
      await this.audit(tx,actor,"purchase_order.draft_updated",id,{});return this.detail(id,tx);
    });
  }
  async receive(id:string, input:ReceiptInput, actor:AuthenticatedStaff) {
    const snapshot={purchaseOrderId:id,actor:actor.staffId,deliveryReference:input.deliveryReference,notes:input.notes,lines:[...input.lines].sort((a,b)=>a.purchaseOrderLineId.localeCompare(b.purchaseOrderLineId))};
    return this.db.transaction(async tx => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${input.operationId}))`);
      const [po] = await tx.select().from(purchaseOrders).where(eq(purchaseOrders.id,id)).for("update");
      if(!po) throw new NotFoundException("Purchase order not found");
      const [existing] = await tx.select().from(goodsReceipts).where(eq(goodsReceipts.operationId,input.operationId));
      if(existing) {
        // JSONB key order differs from JS insertion order; compare canonical field values.
        const previous=existing.requestSnapshot as typeof snapshot;
        if(previous.purchaseOrderId!==snapshot.purchaseOrderId || previous.actor!==snapshot.actor || previous.deliveryReference!==snapshot.deliveryReference || previous.notes!==snapshot.notes || JSON.stringify(previous.lines.map(l=>[l.purchaseOrderLineId,l.accepted,l.rejected]))!==JSON.stringify(snapshot.lines.map(l=>[l.purchaseOrderLineId,l.accepted,l.rejected]))) throw new ConflictException("Operation was already used for another receipt");
        return this.detail(id,tx);
      }
      if(!["approved","partially_received"].includes(po.status)) throw new BadRequestException("Receive only approved orders with outstanding quantities");
      const detail=await this.detail(id,tx);
      const [duplicate]=await tx.select().from(goodsReceipts).where(and(eq(goodsReceipts.purchaseOrderId,id),sql`lower(trim(${goodsReceipts.deliveryReference})) = lower(trim(${input.deliveryReference}))`));
      if(duplicate) throw new ConflictException("That delivery reference is already recorded for this purchase order");
      for(const line of input.lines) {const target=detail.lines.find(l=>l.id===line.purchaseOrderLineId);if(!target) throw new BadRequestException("Receipt line does not belong to this purchase order");if(line.accepted>target.remaining) throw new BadRequestException(`Only ${target.remaining} units remain for ${target.productName}`);}
      const ids=input.lines.filter(l=>l.accepted>0).map(l=>detail.lines.find(p=>p.id===l.purchaseOrderLineId)!.productId);
      const stock=ids.length?await tx.select().from(products).where(inArray(products.id,ids)).orderBy(products.id).for("update"):[];
      const [warehouse]=await tx.select().from(pickupCenters).where(eq(pickupCenters.id,po.warehouseId)).for("share");
      if(!warehouse?.isActive) throw new BadRequestException("Warehouse pickup location is inactive. Reactivate it before receiving.");
      const [receipt]=await tx.insert(goodsReceipts).values({purchaseOrderId:id,warehouseId:po.warehouseId,deliveryReference:input.deliveryReference,notes:input.notes,receivedBy:actor.staffId,operationId:input.operationId,requestSnapshot:snapshot}).returning();
      await tx.insert(goodsReceiptLines).values(input.lines.map(l=>({...l,receiptId:receipt.id})));
      for(const line of input.lines.filter(l=>l.accepted>0)) {
        const target=detail.lines.find(p=>p.id===line.purchaseOrderLineId)!; const p=stock.find(p=>p.id===target.productId)!;
        if(p.unit!==target.unit) throw new BadRequestException(`Stock unit changed for ${p.name}. Resolve the unit mismatch before receiving.`);
        const after=p.stockQuantity+line.accepted;if(after>2147483647) throw new BadRequestException("Stock exceeds supported quantity");
        await tx.update(products).set({stockQuantity:after,updatedAt:new Date()}).where(eq(products.id,p.id));
        const [movement]=await tx.insert(inventoryMovements).values({productId:p.id,productName:p.name,kind:"receive",availableDelta:line.accepted,availableBefore:p.stockQuantity,availableAfter:after,reason:`Received against ${detail.number} at ${po.warehouseName}`,reference:input.deliveryReference,actorStaffId:actor.staffId,receiptId:receipt.id,warehouseId:po.warehouseId,eventKey:`receipt:${receipt.id}:${p.id}`}).returning();
        await changeWarehouseStock(tx,p,po.warehouseId,line.accepted,0,{kind:'receive',eventKey:movement.eventKey,reason:movement.reason,reference:input.deliveryReference,actorStaffId:actor.staffId,inventoryMovementId:movement.id,operationId:input.operationId});
      }
      const complete=detail.lines.every(l=>l.remaining-(input.lines.find(r=>r.purchaseOrderLineId===l.id)?.accepted??0)===0);
      const status=complete?"fully_received":input.lines.some(l=>l.accepted>0)?"partially_received":po.status;
      await tx.update(purchaseOrders).set({status,version:po.version+1,updatedAt:new Date()}).where(eq(purchaseOrders.id,id));
      await this.audit(tx,actor,"purchase_order.received",id,{receiptId:receipt.id,reference:input.deliveryReference});return this.detail(id,tx);
    });
  }
  private audit(tx:Tx,actor:AuthenticatedStaff,action:string,targetId:string,metadata:Record<string,unknown>) {return tx.insert(auditLogs).values({actorStaffId:actor.staffId,action,targetType:action.startsWith("supplier")?"supplier":"purchase_order",targetId,metadata});}
  async receiptOrder(receiptId:string) {const [receipt]=await this.db.select().from(goodsReceipts).where(eq(goodsReceipts.id,receiptId));if(!receipt)throw new NotFoundException("Goods receipt not found");return this.detail(receipt.purchaseOrderId);}
}
