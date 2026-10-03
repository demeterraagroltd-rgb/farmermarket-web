import {randomUUID} from 'node:crypto';
import {afterAll,beforeAll,beforeEach,describe,expect,it,vi} from 'vitest';
import {and,eq} from 'drizzle-orm';
import {brands,categories,products,staff,pickupCenters,warehouseStocks,warehouseMovements,inventoryMovements,users,bnplPlans,orders,orderItems} from '@farmermarket/db';
import {createTestDb,type TestDb} from '../../test/test-db';
import {WarehousesService} from './warehouses.service';
import {InventoryService} from './inventory.service';
import {OrdersService} from '../orders/orders.service';
import {CatalogService} from '../catalog/catalog.service';

describe('Warehouse inventory using actual PostgreSQL migrations',()=>{
 let t:TestDb,w:WarehousesService,inventory:InventoryService,checkout:OrdersService,catalog:CatalogService;
 let p:string,a:string,b:string,actor:string,user:string,plan:string,category:string,brand:string;
 beforeAll(async()=>{
  t=await createTestDb();w=new WarehousesService(t.db);inventory=new InventoryService(t.db);catalog=new CatalogService(t.db);
  const [c]=await t.db.insert(categories).values({name:'Warehouse tests'}).returning();category=c.id;
  const [br]=await t.db.insert(brands).values({name:'Warehouse tests'}).returning();brand=br.id;
  const locations=await t.db.insert(pickupCenters).values([{name:'Abuja pickup',address:'A'},{name:'Lagos pickup',address:'B'}]).returning();a=locations[0].id;b=locations[1].id;
  const [s]=await t.db.insert(staff).values({email:'warehouse@test.com',passwordHash:'x',fullName:'Warehouse Admin',role:'admin'}).returning();actor=s.id;
  const [u]=await t.db.insert(users).values({phone:'08012345679',fullName:'Buyer'}).returning();user=u.id;
  const [pl]=await t.db.insert(bnplPlans).values({name:'Pay now',durationMonths:0}).returning();plan=pl.id;
  checkout=new OrdersService(t.db,{} as never,{assertTxnPin:vi.fn().mockResolvedValue(undefined)} as never,{assertVerified:vi.fn().mockResolvedValue(undefined)} as never,{send:vi.fn().mockResolvedValue(undefined)} as never);
 },20000);
 beforeEach(async()=>{const [pr]=await t.db.insert(products).values({name:'Rice',imageUrl:'https://example.com/rice.png',priceKobo:100000n,categoryId:category,brandId:brand,unit:'bag',stockQuantity:10,status:'published'}).returning();p=pr.id;});
 afterAll(async()=>t?.close());
 const balance=async(location:string)=>(await t.db.select().from(warehouseStocks).where(and(eq(warehouseStocks.productId,p),eq(warehouseStocks.warehouseId,location))))[0];
 const total=async()=>(await t.db.select().from(products).where(eq(products.id,p)))[0].stockQuantity;
 const allocate=(quantity=6)=>w.post('allocation',{productId:p,warehouseId:a,quantity,reason:'Opening stock location',reference:'',operationId:randomUUID()},actor);
 const order=(location=a,quantity=2)=>checkout.create(user,{items:[{productId:p,quantity}],pickupCenterId:location,pickupDate:new Date(),bnplPlanId:plan,txnPin:'1234'});
 it('preserves unassigned stock and allocates opening balances exactly once',async()=>{
  expect((await w.overview()).unassigned.find(r=>r.productId===p)?.available).toBe(10);
  const input={productId:p,warehouseId:a,quantity:6,reason:'Opening assignment',reference:'COUNT-A',operationId:randomUUID()};
  await w.post('allocation',input,actor);await w.post('allocation',input,actor);
  expect(await total()).toBe(10);expect((await balance(a)).available).toBe(6);expect((await w.overview()).unassigned.find(r=>r.productId===p)?.available).toBe(4);
  await expect(w.post('allocation',{...input,quantity:5},actor)).rejects.toThrow('already used');
  await expect(allocate(5)).rejects.toThrow('Only 4');
 });
 it('transfers available stock atomically with paired history and unchanged totals',async()=>{
  await allocate();const input={productId:p,warehouseId:a,destinationId:b,quantity:3,reason:'Move bags to Lagos',reference:'TRANSFER-1',operationId:randomUUID()};
  await w.post('transfer',input,actor);await w.post('transfer',input,actor);
  expect(await total()).toBe(10);expect((await balance(a)).available).toBe(3);expect((await balance(b)).available).toBe(3);
  const history=await t.db.select().from(warehouseMovements).where(eq(warehouseMovements.operationId,input.operationId));expect(history).toHaveLength(2);expect(history[0].inventoryMovementId).toBe(history[1].inventoryMovementId);
  await expect(w.post('transfer',{...input,quantity:4,operationId:randomUUID()},actor)).rejects.toThrow('Not enough stock');expect(await total()).toBe(10);expect((await balance(a)).available).toBe(3);
 });
 it('reserves only the chosen pickup location, releases once and never borrows from another',async()=>{
  await allocate();await w.post('allocation',{productId:p,warehouseId:b,quantity:4,reason:'Lagos opening',reference:'',operationId:randomUUID()},actor);
  const placed=await order(a,3);expect(await total()).toBe(7);expect(await balance(a)).toMatchObject({available:3,reserved:3});expect((await balance(b)).available).toBe(4);
  await expect(order(b,5)).rejects.toThrow('Not enough stock');expect(await total()).toBe(7);
  const preview=await catalog.cartAvailability(b,[{productId:p,quantity:5}]);expect(preview.available).toBe(false);expect(preview.shortages[0]).toMatchObject({available:4,required:5});
  await checkout.reject(placed.id,actor,'Cancelled by buyer');expect(await total()).toBe(10);expect(await balance(a)).toMatchObject({available:6,reserved:0});
  await expect(checkout.reject(placed.id,actor,'Again')).rejects.toThrow();expect(await total()).toBe(10);
 });
 it('fulfils location reservations without a second available deduction',async()=>{
  await allocate();const placed=await order();await t.db.update(orders).set({status:'preparing'}).where(eq(orders.id,placed.id));
  await checkout.updateStatus(placed.id,'delivered',actor);expect(await total()).toBe(8);expect(await balance(a)).toMatchObject({available:4,reserved:0});
 });
 it('counts on-hand stock, protects reserved goods and rejects stale count versions',async()=>{
  await allocate();const before=await balance(a);await order();const current=await balance(a);
  const input={productId:p,warehouseId:a,onHand:9,expectedVersion:current.version,reason:'Physical stock count',reference:'COUNT-1',operationId:randomUUID()};
  await expect(w.post('count',{...input,expectedVersion:before.version},actor)).rejects.toThrow('Stock changed');
  await expect(w.post('count',{...input,onHand:1},actor)).rejects.toThrow('reserved units');
  await w.post('count',input,actor);await w.post('count',input,actor);expect(await total()).toBe(11);expect(await balance(a)).toMatchObject({available:7,reserved:2});
  expect((await w.overview()).unassigned.find(r=>r.productId===p)?.available).toBe(4);
 });
 it('receives to a warehouse and prevents global adjustments consuming allocated stock',async()=>{
  await allocate();await inventory.move(p,{kind:'receive',warehouseId:b,quantity:5,reason:'Supplier delivery',operationId:randomUUID()},actor);expect(await total()).toBe(15);expect((await balance(b)).available).toBe(5);
  await expect(inventory.move(p,{kind:'adjustment',quantity:-5,reason:'Unassigned correction',operationId:randomUUID()},actor)).rejects.toThrow('Only unassigned');
  await inventory.move(p,{kind:'adjustment',warehouseId:b,quantity:-2,reason:'Damaged bags',operationId:randomUUID()},actor);expect(await total()).toBe(13);expect((await balance(b)).available).toBe(3);
 });
 it('assigns legacy reservations without a second deduction and releases to that warehouse',async()=>{
  const [legacy]=await t.db.insert(orders).values({userId:user,bnplPlanId:plan,subtotalKobo:100000n,totalKobo:100000n,stockReserved:true,status:'pending_approval',pickupCenterId:a}).returning();
  await t.db.insert(orderItems).values({orderId:legacy.id,productId:p,name:'Rice',imageUrl:'https://example.com/rice.png',quantity:2,unitPriceKobo:50000n});
  await w.assignLegacyOrder(legacy.id,a,actor);await w.assignLegacyOrder(legacy.id,a,actor);expect(await total()).toBe(10);expect(await balance(a)).toMatchObject({available:0,reserved:2});
  await checkout.reject(legacy.id,actor,'Legacy cancellation');expect(await total()).toBe(12);expect(await balance(a)).toMatchObject({available:2,reserved:0});
 });
 it('protects location history and rejects allocated stock exceeding global stock',async()=>{
  await allocate();await expect(t.db.update(warehouseMovements).set({reason:'Changed'}).where(eq(warehouseMovements.productId,p))).rejects.toThrow();
  await expect(t.db.delete(warehouseMovements).where(eq(warehouseMovements.productId,p))).rejects.toThrow();
  await expect(t.db.update(products).set({stockQuantity:5}).where(eq(products.id,p))).rejects.toThrow();expect(await total()).toBe(10);
  await expect(catalog.updateProduct(p,{unit:'carton'})).rejects.toThrow('Stock units cannot change');
 });
});
