import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { brands,categories,products,staff,pickupCenters,vendors,goodsReceipts,goodsReceiptLines,purchaseOrderLines,inventoryMovements } from "@farmermarket/db";
import { createTestDb,type TestDb } from "../../test/test-db";
import { PurchasingService } from "./purchasing.service";
import { purchaseSchema, receiptSchema, supplierSchema } from "./purchasing.dto";
import type { AuthenticatedStaff } from "../../common/decorators/current-staff.decorator";

describe("Purchasing using actual PostgreSQL migrations",()=>{
 let t:TestDb;let service:PurchasingService;let productId:string;let supplierId:string;let warehouseId:string;
 let preparer:AuthenticatedStaff;let approver:AuthenticatedStaff;let admin:AuthenticatedStaff;
 beforeAll(async()=>{
  t=await createTestDb();service=new PurchasingService(t.db);
  const [category]=await t.db.insert(categories).values({name:"Purchasing tests"}).returning();const [brand]=await t.db.insert(brands).values({name:"Purchasing tests"}).returning();
  const [p]=await t.db.insert(products).values({name:"Rice carton",imageUrl:"https://example.com/rice.png",priceKobo:100000n,categoryId:category.id,brandId:brand.id,unit:"carton",stockQuantity:10}).returning();productId=p.id;
  const people=await t.db.insert(staff).values([{email:"buyer@test.com",fullName:"Buyer",passwordHash:"x",role:"super_admin"},{email:"approver@test.com",fullName:"Approver",passwordHash:"x",role:"super_admin"},{email:"admin@test.com",fullName:"Receiver",passwordHash:"x",role:"admin"}]).returning();preparer={staffId:people[0].id,role:"super_admin"};approver={staffId:people[1].id,role:"super_admin"};admin={staffId:people[2].id,role:"admin"};
  const [w]=await t.db.insert(pickupCenters).values({name:"Pickup warehouse",address:"Test centre"}).returning();warehouseId=w.id;
  const supplier=await service.saveSupplier(supplierSchema.parse({name:"Existing supplier",paymentTermsDays:30}),admin);supplierId=supplier.id;
 },20000);
 afterAll(async()=>t?.close());
 const input=()=>purchaseSchema.parse({supplierId,warehouseId,lines:[{productId,quantity:20,unitCostNaira:500}],notes:"Test purchase"});
 const stock=async()=>(await t.db.select().from(products).where(eq(products.id,productId)))[0].stockQuantity;
 const approved=async()=>{let po=await service.create(input(),preparer);po=await service.transition(po.id,{action:"submit",version:po.version,reason:""},preparer);return service.transition(po.id,{action:"approve",version:po.version,reason:""},approver);};
 it("numbers drafts, snapshots costs and reuses pickup centres as warehouses",async()=>{
  const po=await service.create(input(),preparer);expect(po.number).toMatch(/^PO-\d{6}$/);expect(po.total).toBe(10000);expect(po.warehouseId).toBe(warehouseId);expect(po.warehouseName).toBe("Pickup warehouse");expect(po.lines[0].unit).toBe("carton");
  await t.db.update(products).set({name:"Renamed rice",priceKobo:200000n}).where(eq(products.id,productId));expect((await service.detail(po.id)).lines[0].productName).toBe("Rice carton");expect((await service.detail(po.id)).total).toBe(10000);
 });
 it("enforces separate approval, role restrictions and stale versions",async()=>{
  let po=await service.create(input(),preparer);po=await service.transition(po.id,{action:"submit",version:po.version,reason:""},preparer);
  await expect(service.transition(po.id,{action:"approve",version:po.version,reason:""},preparer)).rejects.toThrow("Another super admin");await expect(service.transition(po.id,{action:"approve",version:po.version,reason:""},admin)).rejects.toThrow("Only a super admin");await expect(service.transition(po.id,{action:"approve",version:1,reason:""},approver)).rejects.toThrow("changed");
 });
 it("supports returned draft changes while locking submitted/approved snapshots",async()=>{
  let po=await service.create(input(),preparer);const original=po.version;po=await service.updateDraft(po.id,{...input(),version:original,lines:[{productId,quantity:12,unitCostNaira:450}]},preparer);expect(po.total).toBe(5400);
  await expect(service.updateDraft(po.id,{...input(),version:original},preparer)).rejects.toThrow("changed");po=await service.transition(po.id,{action:"submit",version:po.version,reason:""},preparer);
  await expect(service.updateDraft(po.id,{...input(),version:po.version},preparer)).rejects.toThrow("Only drafts");await expect(t.db.update(purchaseOrderLines).set({quantity:100}).where(eq(purchaseOrderLines.purchaseOrderId,po.id))).rejects.toThrow();
  po=await service.transition(po.id,{action:"return",version:po.version,reason:"Correct costs"},approver);expect((await service.updateDraft(po.id,{...input(),version:po.version},preparer)).status).toBe("draft");
 });
 it("receives partially, retries once, rejects damaged goods, and completes delivery",async()=>{
  const po=await approved();const before=await stock();const request=receiptSchema.parse({deliveryReference:"delivery-one",operationId:randomUUID(),lines:[{purchaseOrderLineId:po.lines[0].id,accepted:8,rejected:2}]});
  const received=await service.receive(po.id,request,admin);expect(received.status).toBe("partially_received");expect(received.lines[0]).toMatchObject({received:8,rejected:2,remaining:12});expect(await stock()).toBe(before+8);
  await service.receive(po.id,request,admin);expect(await stock()).toBe(before+8);expect((await service.detail(po.id)).receipts).toHaveLength(1);
  await expect(service.receive(po.id,{...request,notes:"Changed request"},admin)).rejects.toThrow("another receipt");
  const [movement]=await t.db.select().from(inventoryMovements).where(eq(inventoryMovements.receiptId,received.receipts[0].id));expect(movement).toMatchObject({availableDelta:8,warehouseId,actorStaffId:admin.staffId});
  const completed=await service.receive(po.id,{...request,deliveryReference:"delivery-two",operationId:randomUUID(),lines:[{purchaseOrderLineId:po.lines[0].id,accepted:12,rejected:0}]},admin);expect(completed.status).toBe("fully_received");expect(await stock()).toBe(before+20);
 });
 it("rolls back over-receiving and prevents duplicate delivery references",async()=>{
  const po=await approved();const before=await stock();const request=receiptSchema.parse({deliveryReference:"oversell-test",operationId:randomUUID(),lines:[{purchaseOrderLineId:po.lines[0].id,accepted:21}]});
  await expect(service.receive(po.id,request,admin)).rejects.toThrow("Only 20");expect(await stock()).toBe(before);expect((await service.detail(po.id)).receipts).toHaveLength(0);
  await service.receive(po.id,{...request,lines:[{purchaseOrderLineId:po.lines[0].id,accepted:1,rejected:0}]},admin);
  await expect(service.receive(po.id,{...request,operationId:randomUUID(),deliveryReference:" OVERSELL-TEST ",lines:[{purchaseOrderLineId:po.lines[0].id,accepted:1,rejected:0}]},admin)).rejects.toThrow("already recorded");expect(await stock()).toBe(before+1);
 });
 it("protects posted receipts and closes remaining quantities without removing stock",async()=>{
  let po=await approved();po=await service.receive(po.id,receiptSchema.parse({deliveryReference:"immutable",operationId:randomUUID(),lines:[{purchaseOrderLineId:po.lines[0].id,accepted:1}]}),admin);const before=await stock();
  await expect(t.db.delete(goodsReceipts).where(eq(goodsReceipts.id,po.receipts[0].id))).rejects.toThrow();await expect(t.db.update(goodsReceiptLines).set({accepted:99}).where(eq(goodsReceiptLines.receiptId,po.receipts[0].id))).rejects.toThrow();
  await expect(service.transition(po.id,{action:"close",version:po.version,reason:"Supplier short delivery"},admin)).rejects.toThrow("super admin");po=await service.transition(po.id,{action:"close",version:po.version,reason:"Supplier short delivery"},approver);expect(po.status).toBe("closed");expect(await stock()).toBe(before);
 });
 it("rejects inactive suppliers/warehouses and receipts before approval",async()=>{
  const po=await service.create(input(),preparer);await expect(service.receive(po.id,receiptSchema.parse({deliveryReference:"not-approved",operationId:randomUUID(),lines:[{purchaseOrderLineId:po.lines[0].id,accepted:1}]}),admin)).rejects.toThrow("approved");
  await t.db.update(pickupCenters).set({isActive:false}).where(eq(pickupCenters.id,warehouseId));await expect(service.create(input(),preparer)).rejects.toThrow("active pickup");await t.db.update(pickupCenters).set({isActive:true}).where(eq(pickupCenters.id,warehouseId));
  await t.db.update(vendors).set({isActive:false}).where(eq(vendors.id,supplierId));await expect(service.create(input(),preparer)).rejects.toThrow("active supplier");await t.db.update(vendors).set({isActive:true}).where(eq(vendors.id,supplierId));
 });
 it("rolls back receiving when a product sale unit changes",async()=>{
  const po=await approved();const before=await stock();
  await t.db.update(products).set({unit:"bag"}).where(eq(products.id,productId));
  await expect(service.receive(po.id,receiptSchema.parse({deliveryReference:"changed-unit",operationId:randomUUID(),lines:[{purchaseOrderLineId:po.lines[0].id,accepted:1}]}),admin)).rejects.toThrow();
  expect(await stock()).toBe(before);expect((await service.detail(po.id)).receipts).toHaveLength(0);
  await t.db.update(products).set({unit:"carton"}).where(eq(products.id,productId));
 });
 it("rejects duplicate products, fractional stock and malformed costs",()=>{
  expect(purchaseSchema.safeParse({...input(),lines:[input().lines[0],input().lines[0]]}).success).toBe(false);expect(purchaseSchema.safeParse({...input(),lines:[{productId,quantity:1.5,unitCostNaira:10}]}).success).toBe(false);expect(purchaseSchema.safeParse({...input(),lines:[{productId,quantity:1,unitCostNaira:10.001}]}).success).toBe(false);
 });
});
