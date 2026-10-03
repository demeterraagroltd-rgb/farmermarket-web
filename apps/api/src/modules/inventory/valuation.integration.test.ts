import {randomUUID} from "node:crypto";
import {afterAll,beforeAll,beforeEach,describe,expect,it,vi} from "vitest";
import {eq} from "drizzle-orm";
import {brands,categories,products,staff,users,pickupCenters,bnplPlans,orders,orderItems,bundles,bundleItems,inventoryCostLots,inventoryCostEntries} from "@farmermarket/db";
import {createTestDb,type TestDb} from "../../test/test-db";
import {ValuationService} from "./valuation.service";
import {InventoryService} from "./inventory.service";
import {OrdersService} from "../orders/orders.service";
import {PurchasingService} from "../purchasing/purchasing.service";
import {purchaseSchema,receiptSchema,supplierSchema} from "../purchasing/purchasing.dto";
import type {AuthenticatedStaff} from "../../common/decorators/current-staff.decorator";

describe("FIFO inventory valuation with actual PostgreSQL migrations",()=>{
 let t:TestDb,value:ValuationService,stock:InventoryService,purchase:PurchasingService,checkout:OrdersService;
 let category:string,brand:string,warehouse:string,supplier:string,user:string,plan:string,p:string;
 let buyer:AuthenticatedStaff,approver:AuthenticatedStaff,admin:AuthenticatedStaff;
 beforeAll(async()=>{
  t=await createTestDb();value=new ValuationService(t.db);stock=new InventoryService(t.db);purchase=new PurchasingService(t.db);
  const [c]=await t.db.insert(categories).values({name:"Valuation"}).returning();category=c.id;
  const [b]=await t.db.insert(brands).values({name:"Valuation"}).returning();brand=b.id;
  const people=await t.db.insert(staff).values([{email:"cost-buyer@test.com",fullName:"Buyer",passwordHash:"x",role:"super_admin"},{email:"cost-approver@test.com",fullName:"Approver",passwordHash:"x",role:"super_admin"},{email:"cost-admin@test.com",fullName:"Admin",passwordHash:"x",role:"admin"}]).returning();
  buyer={staffId:people[0].id,role:"super_admin"};approver={staffId:people[1].id,role:"super_admin"};admin={staffId:people[2].id,role:"admin"};
  const [w]=await t.db.insert(pickupCenters).values({name:"Cost warehouse",address:"Test"}).returning();warehouse=w.id;
  supplier=(await purchase.saveSupplier(supplierSchema.parse({name:"Cost supplier"}),admin)).id;
  const [u]=await t.db.insert(users).values({phone:"08012345670",fullName:"Cost buyer"}).returning();user=u.id;
  const [pl]=await t.db.insert(bnplPlans).values({name:"Pay now",durationMonths:0}).returning();plan=pl.id;
  checkout=new OrdersService(t.db,{} as never,{assertTxnPin:vi.fn().mockResolvedValue(undefined)} as never,{assertVerified:vi.fn().mockResolvedValue(undefined)} as never,{send:vi.fn().mockResolvedValue(undefined)} as never);
 },20000);
 beforeEach(async()=>{const [product]=await t.db.insert(products).values({name:randomUUID(),imageUrl:"https://example.com/rice.png",categoryId:category,brandId:brand,unit:"carton",priceKobo:50000n,status:"published",stockQuantity:0}).returning();p=product.id;});
 afterAll(async()=>t?.close());
 const receive=async(quantity:number,cost:number,productId=p)=>{
  let po=await purchase.create(purchaseSchema.parse({supplierId:supplier,warehouseId:warehouse,lines:[{productId,quantity,unitCostNaira:cost}]}),buyer);
  po=await purchase.transition(po.id,{action:"submit",version:po.version,reason:""},buyer);po=await purchase.transition(po.id,{action:"approve",version:po.version,reason:""},approver);
  const input=receiptSchema.parse({deliveryReference:randomUUID(),operationId:randomUUID(),lines:[{purchaseOrderLineId:po.lines[0].id,accepted:quantity}]});
  await purchase.receive(po.id,input,admin);return {po,input};
 };
 const manual=async(quantity:number)=>stock.move(p,{kind:quantity>0?"receive":"adjustment",quantity,warehouseId:warehouse,reason:"Physical receipt / stock correction",operationId:randomUUID()},admin.staffId);
 const product=async()=>(await value.overview()).products.find(r=>r.id===p)!;
 const order=async(items=[{productId:p,quantity:1}])=>checkout.create(user,{items,pickupCenterId:warehouse,pickupDate:new Date(),bnplPlanId:plan,txnPin:"1234"});
 const collect=async(id:string)=>{await t.db.update(orders).set({status:"preparing"}).where(eq(orders.id,id));return checkout.updateStatus(id,"delivered",admin.staffId);};
 const report=()=>value.report("2000-01-01","2099-12-31");
 it("keeps unknown received costs visible and permits audited cost assignment once",async()=>{
  await manual(10);let row=await product();expect(row).toMatchObject({onHand:10,knownValue:0,unknownUnits:10,complete:false});
  const lot=row.lots[0],input={unitCostNaira:123.45,version:lot.version,reason:"Actual supplier receipt",operationId:randomUUID()};
  await expect(value.assign(lot.id,input,admin)).rejects.toThrow("super admin");
  await value.assign(lot.id,input,buyer);await value.assign(lot.id,input,buyer);row=await product();expect(row).toMatchObject({onHand:10,knownValue:1234.5,unknownUnits:0,complete:true});
  await expect(value.assign(lot.id,{...input,reason:"Changed reason"},buyer)).rejects.toThrow("another cost assignment");
  await expect(value.assign(lot.id,{...input,version:row.lots[0].version,operationId:randomUUID()},buyer)).rejects.toThrow("Known costs");
 });
 it("costs FIFO receipts at collection, leaves reservations valued and blocks duplicate fulfilment",async()=>{
  const first=await receive(2,100);await purchase.receive(first.po.id,first.input,admin);await receive(3,200);
  expect(await product()).toMatchObject({onHand:5,knownValue:800,complete:true});
  const placed=await order([{productId:p,quantity:3}]);expect(await product()).toMatchObject({onHand:5,reserved:3,knownValue:800});
  await collect(placed.id);const result=(await report()).orders.find(o=>o.id===placed.id)!;
  expect(result).toMatchObject({revenue:1500,knownCogs:400,grossMargin:1100,complete:true});expect(await product()).toMatchObject({onHand:2,knownValue:400});
  await expect(checkout.updateStatus(placed.id,"delivered",admin.staffId)).rejects.toThrow("already closed");
 });
 it("releases cancelled orders without consuming cost lots",async()=>{
  await receive(4,100);const placed=await order([{productId:p,quantity:2}]);await checkout.reject(placed.id,admin.staffId,"Buyer cancelled");
  expect(await product()).toMatchObject({onHand:4,knownValue:400});expect((await report()).orders.some(o=>o.id===placed.id)).toBe(false);
 });
 it("keeps historical unknown COGS incomplete after remaining stock receives a cost",async()=>{
  await manual(3);const old=(await product()).lots[0];const placed=await order();await collect(placed.id);
  await expect(value.assign(old.id,{unitCostNaira:100,version:old.version,reason:"Receipt found later",operationId:randomUUID()},buyer)).rejects.toThrow("Stock changed");
  const remaining=(await product()).lots[0];await value.assign(remaining.id,{unitCostNaira:100,version:remaining.version,reason:"Receipt found later",operationId:randomUUID()},buyer);
  expect(await product()).toMatchObject({knownValue:200,unknownUnits:0});expect((await report()).orders.find(o=>o.id===placed.id)).toMatchObject({knownCogs:0,missingUnits:1,complete:false,grossMargin:null});
 });
 it("records stock losses separately from order COGS and treats new unexplained stock as unknown",async()=>{
  await receive(4,100);await manual(-2);await manual(1);expect(await product()).toMatchObject({onHand:3,knownValue:200,unknownUnits:1});
  const result=await report();expect(result.knownStockLoss).toBe(200);expect(result.unknownLossUnits).toBe(0);
 });
 it("costs shared bundle and individual components while retaining bundle selling revenue",async()=>{
  await t.db.update(products).set({priceKobo:100000n}).where(eq(products.id,p));await receive(6,100);
  const [oil]=await t.db.insert(products).values({name:"Bundle oil",imageUrl:"https://example.com/oil.png",categoryId:category,brandId:brand,unit:"bottle",priceKobo:50000n,status:"published"}).returning();await receive(10,50,oil.id);
  const [bundle]=await t.db.insert(bundles).values({name:"Cost bundle",slug:randomUUID(),description:"Bundle",imageUrl:"https://example.com/bundle.png",bundlePriceKobo:170000n,active:true}).returning();
  await t.db.insert(bundleItems).values([{bundleId:bundle.id,productId:p,quantity:1},{bundleId:bundle.id,productId:oil.id,quantity:2}]);
  const placed=await checkout.create(user,{items:[{bundleId:bundle.id,quantity:2},{productId:oil.id,quantity:1}],pickupCenterId:warehouse,pickupDate:new Date(),bnplPlanId:plan,txnPin:"1234"});await collect(placed.id);
  expect((await report()).orders.find(o=>o.id===placed.id)).toMatchObject({revenue:3900,knownCogs:450,grossMargin:3450,complete:true});
 });
 it("marks legacy sales without cost entries incomplete and excludes fees from product revenue",async()=>{
  const [legacy]=await t.db.insert(orders).values({userId:user,bnplPlanId:plan,status:"delivered",subtotalKobo:50000n,totalKobo:100000n,deliveryFeeKobo:50000n}).returning();
  await t.db.insert(orderItems).values({orderId:legacy.id,productId:p,name:"Legacy stock",imageUrl:"https://example.com/rice.png",quantity:2,unitPriceKobo:25000n});
  expect((await report()).orders.find(o=>o.id===legacy.id)).toMatchObject({revenue:500,missingUnits:2,grossMargin:null,complete:false});
 });
 it("preserves cost snapshots and rejects direct changes to known costs",async()=>{
  await receive(2,100);const placed=await order();await collect(placed.id);
  const lot=(await product()).lots[0];await expect(t.db.update(inventoryCostLots).set({unitCostKobo:1n}).where(eq(inventoryCostLots.id,lot.id))).rejects.toThrow();
  const [entry]=await t.db.select().from(inventoryCostEntries);await expect(t.db.update(inventoryCostEntries).set({quantity:999}).where(eq(inventoryCostEntries.id,entry.id))).rejects.toThrow();
 });
});
