import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { brands,categories,products,staff,pickupCenters,supplierInvoices,supplierInvoiceLines,supplierPayments,supplierPaymentReversals,supplierCreditNotes,supplierCreditReversals } from "@farmermarket/db";
import { createTestDb,type TestDb } from "../../test/test-db";
import { PurchasingService } from "./purchasing.service";
import { PayablesService } from "./payables.service";
import { invoiceSchema, paymentSchema, creditSchema } from "./payables.dto";
import { supplierSchema, purchaseSchema, receiptSchema } from "./purchasing.dto";
import type { AuthenticatedStaff } from "../../common/decorators/current-staff.decorator";

describe("Supplier payables using actual PostgreSQL migrations",()=>{
  let t:TestDb,purchasing:PurchasingService,payables:PayablesService,productId:string,supplierId:string,warehouseId:string;
  let buyer:AuthenticatedStaff,reviewer:AuthenticatedStaff,admin:AuthenticatedStaff;
  beforeAll(async()=>{
    t=await createTestDb();purchasing=new PurchasingService(t.db);payables=new PayablesService(t.db);
    const [category]=await t.db.insert(categories).values({name:"Payables"}).returning();
    const [brand]=await t.db.insert(brands).values({name:"Payables"}).returning();
    const [product]=await t.db.insert(products).values({name:"Rice",imageUrl:"https://example.com/rice.png",priceKobo:100000n,categoryId:category.id,brandId:brand.id,unit:"bag",stockQuantity:0}).returning();productId=product.id;
    const people=await t.db.insert(staff).values([{email:"payable-buyer@test.com",fullName:"Buyer",passwordHash:"x",role:"super_admin"},{email:"payable-reviewer@test.com",fullName:"Reviewer",passwordHash:"x",role:"super_admin"},{email:"payable-admin@test.com",fullName:"Admin",passwordHash:"x",role:"admin"}]).returning();
    buyer={staffId:people[0].id,role:"super_admin"};reviewer={staffId:people[1].id,role:"super_admin"};admin={staffId:people[2].id,role:"admin"};
    const [warehouse]=await t.db.insert(pickupCenters).values({name:"Payables warehouse",address:"Test"}).returning();warehouseId=warehouse.id;
    supplierId=(await purchasing.saveSupplier(supplierSchema.parse({name:"Supplier"}),admin)).id;
  },20000);
  afterAll(async()=>t?.close());
  const received=async(accepted=10)=>{
    let po=await purchasing.create(purchaseSchema.parse({supplierId,warehouseId,lines:[{productId,quantity:10,unitCostNaira:500.25}]}),buyer);
    po=await purchasing.transition(po.id,{action:"submit",version:po.version,reason:""},buyer);
    po=await purchasing.transition(po.id,{action:"approve",version:po.version,reason:""},reviewer);
    return purchasing.receive(po.id,receiptSchema.parse({deliveryReference:randomUUID(),operationId:randomUUID(),lines:[{purchaseOrderLineId:po.lines[0].id,accepted,rejected:2}]}),admin);
  };
  const draft=async(qty=10)=>{
    const po=await received();const input=invoiceSchema.parse({purchaseOrderId:po.id,reference:randomUUID(),invoiceDate:"2020-01-01",dueDate:"2020-02-01",operationId:randomUUID(),lines:[{purchaseOrderLineId:po.lines[0].id,quantity:qty}]});
    return {po,input,invoice:await payables.create(input,admin)};
  };
  const posted=async()=>{const d=await draft();return payables.action(d.invoice.id,{action:"post",version:d.invoice.version,reason:""},reviewer);};
  const payment=(amountNaira:number)=>paymentSchema.parse({amountNaira,paymentDate:"2020-01-02",method:"bank_transfer",reference:randomUUID(),operationId:randomUUID()});
  it("matches only accepted, uninvoiced quantities and preserves purchase cost",async()=>{
    const po=await received(4);const match=await payables.match(po.id);expect(match.lines[0]).toMatchObject({accepted:4,invoiced:0,remaining:4,unitCost:500.25});
    const input=invoiceSchema.parse({purchaseOrderId:po.id,reference:randomUUID(),invoiceDate:"2020-01-01",dueDate:"2020-01-31",operationId:randomUUID(),lines:[{purchaseOrderLineId:po.lines[0].id,quantity:5}]});
    await expect(payables.create(input,admin)).rejects.toThrow("Only 4");
    const invoice=await payables.create({...input,lines:[{purchaseOrderLineId:po.lines[0].id,quantity:4}]},admin);
    expect(invoice.total).toBe(2001);expect(invoice.balance).toBe(0);expect(invoice.lines[0].unit).toBe("bag");
    const other=await received();await expect(payables.create({...input,operationId:randomUUID(),reference:randomUUID(),lines:[{purchaseOrderLineId:other.lines[0].id,quantity:1}]},admin)).rejects.toThrow("does not belong");
  });
  it("keeps drafts out of balances, protects separate posting and stale versions",async()=>{
    const {invoice}=await draft();await expect(payables.action(invoice.id,{action:"post",version:invoice.version,reason:""},admin)).rejects.toThrow("super admin");
    const own=await received();const created=await payables.create(invoiceSchema.parse({purchaseOrderId:own.id,reference:randomUUID(),invoiceDate:"2020-01-01",dueDate:"2020-01-01",operationId:randomUUID(),lines:[{purchaseOrderLineId:own.lines[0].id,quantity:1}]}),buyer);
    await expect(payables.action(created.id,{action:"post",version:1,reason:""},buyer)).rejects.toThrow("Another super admin");
    const posted=await payables.action(invoice.id,{action:"post",version:1,reason:""},reviewer);expect(posted.balance).toBe(5002.5);expect(posted.overdue).toBe(true);
    await expect(payables.action(posted.id,{action:"void",version:1,reason:"Wrong invoice"},reviewer)).rejects.toThrow("changed");
  });
  it("prevents two drafts from billing the same delivered quantity",async()=>{
    const {po,input,invoice}=await draft();const other=await payables.create({...input,reference:randomUUID(),operationId:randomUUID()},admin);
    await payables.action(invoice.id,{action:"post",version:1,reason:""},reviewer);
    await expect(payables.action(other.id,{action:"post",version:1,reason:""},reviewer)).rejects.toThrow("invoiced elsewhere");expect((await payables.match(po.id)).lines[0].remaining).toBe(0);
  });
  it("deduplicates invoice retries and normalises supplier references across orders",async()=>{
    const {input,invoice}=await draft();expect((await payables.create(input,admin)).id).toBe(invoice.id);
    await expect(payables.create({...input,notes:"changed"},admin)).rejects.toThrow("another invoice");
    const po=await received();await expect(payables.create({...input,purchaseOrderId:po.id,reference:` ${input.reference.toUpperCase()} `,operationId:randomUUID(),lines:[{purchaseOrderLineId:po.lines[0].id,quantity:1}]},admin)).rejects.toThrow("already recorded");
  });
  it("records partial/full payments once, rejects overpayment and role misuse",async()=>{
    const invoice=await posted(),input=payment(1000.25);
    await expect(payables.pay(invoice.id,input,admin)).rejects.toThrow("super admin");
    const partial=await payables.pay(invoice.id,input,reviewer);expect(partial).toMatchObject({paid:1000.25,balance:4002.25,paymentStatus:"partially_paid"});
    expect((await payables.pay(invoice.id,input,reviewer)).payments).toHaveLength(1);
    await expect(payables.pay(invoice.id,{...input,amountNaira:1001},reviewer)).rejects.toThrow("another payment");
    await expect(payables.pay(invoice.id,payment(4003),reviewer)).rejects.toThrow("exceeds");
    const full=await payables.pay(invoice.id,payment(4002.25),reviewer);expect(full).toMatchObject({paid:5002.5,balance:0,paymentStatus:"paid",overdue:false});
  });
  it("blocks duplicate payment references across supplier invoices",async()=>{
    const first=await posted(),second=await posted(),input=payment(100);
    await payables.pay(first.id,input,reviewer);
    await expect(payables.pay(second.id,{...input,operationId:randomUUID(),reference:` ${input.reference.toUpperCase()} `},reviewer)).rejects.toThrow("already recorded");
    expect((await payables.detail(second.id)).paid).toBe(0);
  });
  it("preserves payment history through reversal and restores payable quantity after void",async()=>{
    const invoice=await posted(),paid=await payables.pay(invoice.id,payment(5002.5),reviewer),id=paid.payments[0].id;
    await expect(payables.action(invoice.id,{action:"void",version:paid.version,reason:"Incorrect invoice"},reviewer)).rejects.toThrow("Reverse");
    await expect(payables.reverse(id,"Entered in error",admin)).rejects.toThrow("super admin");
    const reversed=await payables.reverse(id,"Entered in error",reviewer);expect(reversed.balance).toBe(5002.5);expect(reversed.payments[0].reversal?.reason).toBe("Entered in error");
    expect((await payables.reverse(id,"Entered in error",reviewer)).paid).toBe(0);
    const voided=await payables.action(invoice.id,{action:"void",version:reversed.version,reason:"Incorrect invoice"},reviewer);expect(voided.balance).toBe(0);expect((await payables.match(invoice.purchaseOrderId)).lines[0].remaining).toBe(10);
    await expect(payables.pay(invoice.id,payment(100),reviewer)).rejects.toThrow("posted invoice");
  });
  it("enforces immutable financial records at database level",async()=>{
    const invoice=await posted(),paid=await payables.pay(invoice.id,payment(1),reviewer);
    await expect(t.db.update(supplierInvoices).set({totalKobo:1n}).where(eq(supplierInvoices.id,invoice.id))).rejects.toThrow();
    await expect(t.db.delete(supplierInvoices).where(eq(supplierInvoices.id,invoice.id))).rejects.toThrow();
    await expect(t.db.update(supplierInvoiceLines).set({quantity:1}).where(eq(supplierInvoiceLines.invoiceId,invoice.id))).rejects.toThrow();
    await expect(t.db.delete(supplierPayments).where(eq(supplierPayments.id,paid.payments[0].id))).rejects.toThrow();
    await payables.reverse(paid.payments[0].id,"Test correction",reviewer);
    await expect(t.db.delete(supplierPaymentReversals).where(eq(supplierPaymentReversals.paymentId,paid.payments[0].id))).rejects.toThrow();
  });
  it("reports supplier balances accurately without changing stock",async()=>{
    const before=(await t.db.select().from(products).where(eq(products.id,productId)))[0].stockQuantity;
    const overview=await payables.overview();const supplier=overview.suppliers.find(s=>s.id===supplierId)!;
    expect(supplier.balance).toBe(overview.invoices.filter(i=>i.status==="posted").reduce((n,i)=>n+i.balance,0));expect(overview.outstanding).toBe(supplier.balance);expect(overview.overdue).toBe(supplier.overdue);
    expect((await t.db.select().from(products).where(eq(products.id,productId)))[0].stockQuantity).toBe(before);
  });
  it("validates dates and precision, forbids future and pre-invoice payments",async()=>{
    expect(paymentSchema.safeParse({...payment(1),amountNaira:1.001}).success).toBe(false);
    expect(paymentSchema.safeParse({...payment(1),paymentDate:"2020-02-31"}).success).toBe(false);
    const invoice=await posted();await expect(payables.pay(invoice.id,{...payment(1),paymentDate:"2099-01-01"},reviewer)).rejects.toThrow("future");
    await expect(payables.pay(invoice.id,{...payment(1),paymentDate:"2019-12-31"},reviewer)).rejects.toThrow("precede");
    const {invoice:d}=await draft();await expect(payables.pay(d.id,payment(1),reviewer)).rejects.toThrow("posted invoice");
  });
  const creditInput=(amountNaira:number)=>creditSchema.parse({amountNaira,reference:randomUUID(),creditDate:"2020-01-03",reason:"Supplier invoice discount",operationId:randomUUID()});
  const postCredit=async(invoiceId:string,amount:number)=>{
    const draft=await payables.createCredit(invoiceId,creditInput(amount),admin);
    const note=draft.creditNotes.find(c=>c.status==="draft")!;
    return payables.creditAction(note.id,{action:"post",version:note.version,reason:""},reviewer);
  };
  it("keeps credit drafts out of balances and enforces separate approval",async()=>{
    const invoice=await posted(),input=creditInput(100.25);
    const drafted=await payables.createCredit(invoice.id,input,buyer),note=drafted.creditNotes[0];
    expect(drafted.balance).toBe(invoice.total);expect(drafted.credited).toBe(0);
    await expect(payables.creditAction(note.id,{action:"post",version:1,reason:""},admin)).rejects.toThrow("super admin");
    await expect(payables.creditAction(note.id,{action:"post",version:1,reason:""},buyer)).rejects.toThrow("Another super admin");
    const result=await payables.creditAction(note.id,{action:"post",version:1,reason:""},reviewer);
    expect(result).toMatchObject({credited:100.25,balance:4902.25,supplierCredit:0});
    await expect(payables.creditAction(note.id,{action:"post",version:1,reason:""},reviewer)).rejects.toThrow("changed");
  });
  it("subtracts credits when validating payments and excludes refunded credit from overdue",async()=>{
    const invoice=await posted();await postCredit(invoice.id,1000);
    await expect(payables.pay(invoice.id,payment(5002.5),reviewer)).rejects.toThrow("exceeds");
    const paid=await payables.pay(invoice.id,payment(4002.5),reviewer);expect(paid).toMatchObject({balance:0,paid:4002.5,credited:1000,overdue:false});
  });
  it("shows supplier credit owed after a paid invoice is credited without changing payments or stock",async()=>{
    const invoice=await posted();const paid=await payables.pay(invoice.id,payment(5002.5),reviewer);
    const before=(await t.db.select().from(products).where(eq(products.id,productId)))[0].stockQuantity;
    const result=await postCredit(invoice.id,100.1);
    expect(result).toMatchObject({balance:0,paid:5002.5,credited:100.1,supplierCredit:100.1,paymentStatus:"credit_due",overdue:false});expect(result.payments[0].id).toBe(paid.payments[0].id);
    expect((await t.db.select().from(products).where(eq(products.id,productId)))[0].stockQuantity).toBe(before);
    const overview=await payables.overview();expect(overview.supplierCredit).toBe(100.1);expect(overview.suppliers.find(s=>s.id===supplierId)?.supplierCredit).toBe(100.1);
  });
  it("prevents over-crediting even when multiple drafts were prepared",async()=>{
    const invoice=await posted();const first=await payables.createCredit(invoice.id,creditInput(3000),admin);
    const second=await payables.createCredit(invoice.id,creditInput(3000),admin);const newer=second.creditNotes.find(c=>!first.creditNotes.some(f=>f.id===c.id))!;
    await payables.creditAction(first.creditNotes[0].id,{action:"post",version:1,reason:""},reviewer);
    await expect(payables.creditAction(newer.id,{action:"post",version:1,reason:""},reviewer)).rejects.toThrow("Other credit notes");
    await expect(payables.createCredit(invoice.id,creditInput(2003),admin)).rejects.toThrow("exceeds");
  });
  it("deduplicates credit creation and rejects reused supplier references across invoices",async()=>{
    const invoice=await posted(),input=creditInput(1);
    const result=await payables.createCredit(invoice.id,input,admin);expect((await payables.createCredit(invoice.id,input,admin)).creditNotes).toHaveLength(1);
    await expect(payables.createCredit(invoice.id,{...input,amountNaira:2},admin)).rejects.toThrow("another credit note");
    const other=await posted();await expect(payables.createCredit(other.id,{...input,operationId:randomUUID(),reference:` ${input.reference.toUpperCase()} `},admin)).rejects.toThrow("already recorded");
    await payables.creditAction(result.creditNotes[0].id,{action:"void",version:1,reason:"Incorrect document"},reviewer);
    expect((await payables.detail(invoice.id)).balance).toBe(invoice.total);
  });
  it("reverses posted credits without deleting them and protects invoice voiding",async()=>{
    const invoice=await posted(),credited=await postCredit(invoice.id,5002.5),note=credited.creditNotes[0];
    expect(credited.paymentStatus).toBe("credited");
    await expect(payables.action(invoice.id,{action:"void",version:credited.version,reason:"Incorrect invoice"},reviewer)).rejects.toThrow("Reverse posted credit");
    await expect(t.db.update(supplierCreditNotes).set({amountKobo:1n}).where(eq(supplierCreditNotes.id,note.id))).rejects.toThrow();
    const result=await payables.creditAction(note.id,{action:"reverse",version:note.version,reason:"Supplier withdrew credit"},reviewer);expect(result).toMatchObject({credited:0,balance:5002.5});expect(result.creditNotes[0].reversal?.reason).toBe("Supplier withdrew credit");
    expect((await payables.creditAction(note.id,{action:"reverse",version:note.version,reason:"Supplier withdrew credit"},reviewer)).credited).toBe(0);
    await expect(t.db.delete(supplierCreditReversals).where(eq(supplierCreditReversals.creditNoteId,note.id))).rejects.toThrow();
    expect((await payables.action(invoice.id,{action:"void",version:result.version,reason:"Incorrect invoice"},reviewer)).balance).toBe(0);
  });
  it("requires posted invoices and valid dates and amounts for credits",async()=>{
    const {invoice}=await draft();await expect(payables.createCredit(invoice.id,creditInput(1),admin)).rejects.toThrow("posted invoice");
    const active=await posted();await expect(payables.createCredit(active.id,{...creditInput(1),creditDate:"2099-01-01"},admin)).rejects.toThrow("future");
    await expect(payables.createCredit(active.id,{...creditInput(1),creditDate:"2019-12-31"},admin)).rejects.toThrow("precede");
    expect(creditSchema.safeParse({...creditInput(1),amountNaira:1.001}).success).toBe(false);
  });
});
