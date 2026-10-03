import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { and, desc, eq, sql } from "drizzle-orm";
import { auditLogs, supplierInvoices, supplierInvoiceLines, supplierPayments, supplierPaymentReversals, supplierCreditNotes, supplierCreditReversals, purchaseOrders, purchaseOrderLines, goodsReceipts, goodsReceiptLines, vendors, type Db, type Tx } from "@farmermarket/db";
import { koboToNaira, nairaToKobo } from "@farmermarket/core";
import { DB } from "../../db/db.module";
import type { AuthenticatedStaff } from "../../common/decorators/current-staff.decorator";
import type { InvoiceInput, InvoiceAction, PaymentInput, CreditInput, CreditAction } from "./payables.dto";

const number = (prefix:string,n:number) => `${prefix}-${String(n).padStart(6,"0")}`;
const today = () => new Date().toISOString().slice(0,10);
const canonical = (v:unknown):string => {
  if(Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if(v && typeof v === "object") return `{${Object.entries(v).sort(([a],[b])=>a.localeCompare(b)).map(([k,x])=>`${JSON.stringify(k)}:${canonical(x)}`).join(",")}}`;
  return JSON.stringify(v);
};
@Injectable()
export class PayablesService {
  constructor(@Inject(DB) private readonly db:Db) {}
  private privileged(actor:AuthenticatedStaff) {
    if(actor.role!=="super_admin") throw new ForbiddenException("Only a super admin can post invoices or credit notes, record payments or reverse financial records");
  }
  private audit(tx:Tx,actor:AuthenticatedStaff,action:string,id:string,metadata:Record<string,unknown>={}) {
    return tx.insert(auditLogs).values({actorStaffId:actor.staffId,action,targetType:"supplier_invoice",targetId:id,metadata});
  }
  private async paid(id:string,source:Db|Tx) {
    const rows=await source.select({amount:supplierPayments.amountKobo,reversal:supplierPaymentReversals.id})
      .from(supplierPayments).leftJoin(supplierPaymentReversals,eq(supplierPaymentReversals.paymentId,supplierPayments.id))
      .where(eq(supplierPayments.invoiceId,id));
    return rows.reduce((sum,p)=>sum+(p.reversal?0n:p.amount),0n);
  }
  private creditRows(source:Db|Tx,invoiceId?:string) {
    const query=source.select({credit:supplierCreditNotes,reversal:supplierCreditReversals})
      .from(supplierCreditNotes).leftJoin(supplierCreditReversals,eq(supplierCreditReversals.creditNoteId,supplierCreditNotes.id));
    return invoiceId?query.where(eq(supplierCreditNotes.invoiceId,invoiceId)).orderBy(desc(supplierCreditNotes.createdAt)):query;
  }
  private async credited(id:string,source:Db|Tx) {
    return (await this.creditRows(source,id)).reduce((sum,c)=>sum+(c.credit.status==="posted"&&!c.reversal?c.credit.amountKobo:0n),0n);
  }
  async detail(id:string,source:Db|Tx=this.db) {
    const [invoice]=await source.select().from(supplierInvoices).where(eq(supplierInvoices.id,id));
    if(!invoice) throw new NotFoundException("Supplier invoice not found");
    const lines=await source.select().from(supplierInvoiceLines).where(eq(supplierInvoiceLines.invoiceId,id));
    const payments=await source.select({payment:supplierPayments,reversal:supplierPaymentReversals})
      .from(supplierPayments).leftJoin(supplierPaymentReversals,eq(supplierPaymentReversals.paymentId,supplierPayments.id))
      .where(eq(supplierPayments.invoiceId,id)).orderBy(desc(supplierPayments.createdAt));
    const paid=payments.reduce((sum,p)=>sum+(p.reversal?0n:p.payment.amountKobo),0n);
    const creditRows=await this.creditRows(source,id);
    const credited=creditRows.reduce((sum,c)=>sum+(c.credit.status==="posted"&&!c.reversal?c.credit.amountKobo:0n),0n);
    const net=invoice.status==="posted"?invoice.totalKobo-paid-credited:0n;
    const balance=net>0n?net:0n,supplierCredit=net<0n?-net:0n;
    return {...invoice,number:number("INV",invoice.sequence),total:koboToNaira(invoice.totalKobo),paid:koboToNaira(paid),credited:koboToNaira(credited),balance:koboToNaira(balance),supplierCredit:koboToNaira(supplierCredit),
      paymentStatus:invoice.status!=="posted"?invoice.status:supplierCredit>0n?"credit_due":balance===0n?(credited>0n&&paid===0n?"credited":"paid"):paid>0n?"partially_paid":"unpaid",
      overdue:balance>0n && invoice.dueDate<today(),
      lines:lines.map(l=>({...l,unitCost:koboToNaira(l.unitCostKobo),total:koboToNaira(l.unitCostKobo*BigInt(l.quantity))})),
      payments:payments.map(({payment:p,reversal})=>({...p,number:number("PAY",p.sequence),amount:koboToNaira(p.amountKobo),reversal})),
      creditNotes:creditRows.map(({credit:c,reversal})=>({...c,number:number("CN",c.sequence),amount:koboToNaira(c.amountKobo),reversal})),
    };
  }
  async overview() {
    return this.db.transaction(async tx=>{
      const invoices=await tx.select().from(supplierInvoices).orderBy(desc(supplierInvoices.createdAt));
      const payments=await tx.select({invoiceId:supplierPayments.invoiceId,amount:supplierPayments.amountKobo,reversal:supplierPaymentReversals.id})
        .from(supplierPayments).leftJoin(supplierPaymentReversals,eq(supplierPaymentReversals.paymentId,supplierPayments.id));
      const suppliers=await tx.select().from(vendors).orderBy(vendors.name);
      const creditRows=await this.creditRows(tx);
      let outstanding=0n,overdue=0n,totalPaid=0n,totalCredits=0n,totalSupplierCredit=0n;
      const balances=new Map<string,bigint>(),lateBalances=new Map<string,bigint>(),supplierCredits=new Map<string,bigint>();
      const rows=invoices.map(i=>{
        const paid=payments.filter(p=>p.invoiceId===i.id&&!p.reversal).reduce((sum,p)=>sum+p.amount,0n);
        const credited=creditRows.filter(c=>c.credit.invoiceId===i.id&&c.credit.status==="posted"&&!c.reversal).reduce((sum,c)=>sum+c.credit.amountKobo,0n);
        const net=i.status==="posted"?i.totalKobo-paid-credited:0n;
        const balance=net>0n?net:0n,supplierCredit=net<0n?-net:0n;
        const late=balance>0n&&i.dueDate<today();
        outstanding+=balance;if(late)overdue+=balance;totalPaid+=paid;
        totalCredits+=credited;totalSupplierCredit+=supplierCredit;
        balances.set(i.supplierId,(balances.get(i.supplierId)??0n)+balance);
        supplierCredits.set(i.supplierId,(supplierCredits.get(i.supplierId)??0n)+supplierCredit);
        if(late)lateBalances.set(i.supplierId,(lateBalances.get(i.supplierId)??0n)+balance);
        return {...i,number:number("INV",i.sequence),total:koboToNaira(i.totalKobo),paid:koboToNaira(paid),credited:koboToNaira(credited),balance:koboToNaira(balance),supplierCredit:koboToNaira(supplierCredit),overdue:late,
          paymentStatus:i.status!=="posted"?i.status:supplierCredit>0n?"credit_due":balance===0n?(credited>0n&&paid===0n?"credited":"paid"):paid>0n?"partially_paid":"unpaid"};
      });
      return {invoices:rows,outstanding:koboToNaira(outstanding),overdue:koboToNaira(overdue),paid:koboToNaira(totalPaid),credited:koboToNaira(totalCredits),supplierCredit:koboToNaira(totalSupplierCredit),
        suppliers:suppliers.map(s=>({id:s.id,name:s.name,balance:koboToNaira(balances.get(s.id)??0n),overdue:koboToNaira(lateBalances.get(s.id)??0n),supplierCredit:koboToNaira(supplierCredits.get(s.id)??0n)}))};
    },{isolationLevel:"repeatable read"});
  }
  // PO row locking serialises invoice matching against receiving and other invoices.
  async match(poId:string,source:Db|Tx=this.db,excludeInvoiceId?:string) {
    const [po]=await source.select().from(purchaseOrders).where(eq(purchaseOrders.id,poId));
    if(!po) throw new NotFoundException("Purchase order not found");
    const [supplier]=await source.select({paymentTermsDays:vendors.paymentTermsDays}).from(vendors).where(eq(vendors.id,po.supplierId));
    const lines=await source.select().from(purchaseOrderLines).where(eq(purchaseOrderLines.purchaseOrderId,poId));
    const receipts=await source.select({line:goodsReceiptLines}).from(goodsReceiptLines).innerJoin(goodsReceipts,eq(goodsReceiptLines.receiptId,goodsReceipts.id)).where(eq(goodsReceipts.purchaseOrderId,poId));
    const invoiced=await source.select({line:supplierInvoiceLines,invoiceId:supplierInvoices.id}).from(supplierInvoiceLines).innerJoin(supplierInvoices,eq(supplierInvoiceLines.invoiceId,supplierInvoices.id)).where(and(eq(supplierInvoices.purchaseOrderId,poId),eq(supplierInvoices.status,"posted")));
    return {purchaseOrderId:po.id,number:number("PO",po.sequence),supplierId:po.supplierId,supplierName:po.supplierName,paymentTermsDays:supplier?.paymentTermsDays??0,status:po.status,
      lines:lines.map(l=>{const accepted=receipts.filter(r=>r.line.purchaseOrderLineId===l.id).reduce((n,r)=>n+r.line.accepted,0);
        const billed=invoiced.filter(r=>r.invoiceId!==excludeInvoiceId&&r.line.purchaseOrderLineId===l.id).reduce((n,r)=>n+r.line.quantity,0);
        return {...l,unitCost:koboToNaira(l.unitCostKobo),accepted,invoiced:billed,remaining:accepted-billed};})};
  }
  async create(input:InvoiceInput,actor:AuthenticatedStaff) {
    if(input.invoiceDate>today()) throw new BadRequestException("Invoice date cannot be in the future");
    const snapshot={...input,actor:actor.staffId,lines:[...input.lines].sort((a,b)=>a.purchaseOrderLineId.localeCompare(b.purchaseOrderLineId))};
    return this.db.transaction(async tx=>{
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${input.operationId}))`);
      const [existing]=await tx.select().from(supplierInvoices).where(eq(supplierInvoices.operationId,input.operationId));
      if(existing) {if(canonical(existing.requestSnapshot)!==canonical(snapshot)) throw new ConflictException("Operation was already used for another invoice");return this.detail(existing.id,tx);}
      const [po]=await tx.select().from(purchaseOrders).where(eq(purchaseOrders.id,input.purchaseOrderId)).for("update");
      if(!po) throw new NotFoundException("Purchase order not found");
      // Supplier lock also protects normalised reference uniqueness across POs.
      await tx.select().from(vendors).where(eq(vendors.id,po.supplierId)).for("update");
      const [duplicate]=await tx.select().from(supplierInvoices).where(and(eq(supplierInvoices.supplierId,po.supplierId),sql`lower(trim(${supplierInvoices.reference}))=lower(trim(${input.reference}))`));
      if(duplicate) throw new ConflictException("Supplier invoice reference is already recorded; use the existing invoice");
      const match=await this.match(po.id,tx);
      const values=input.lines.map(l=>{const target=match.lines.find(p=>p.id===l.purchaseOrderLineId);
        if(!target) throw new BadRequestException("Invoice line does not belong to this purchase order");
        if(l.quantity>target.remaining) throw new BadRequestException(`Only ${target.remaining} accepted, uninvoiced units remain for ${target.productName}`);
        return {purchaseOrderLineId:target.id,productName:target.productName,unit:target.unit,quantity:l.quantity,unitCostKobo:target.unitCostKobo};});
      const total=values.reduce((n,l)=>n+BigInt(l.quantity)*l.unitCostKobo,0n);
      const [invoice]=await tx.insert(supplierInvoices).values({purchaseOrderId:po.id,supplierId:po.supplierId,supplierName:po.supplierName,reference:input.reference,invoiceDate:input.invoiceDate,dueDate:input.dueDate,notes:input.notes,totalKobo:total,createdBy:actor.staffId,operationId:input.operationId,requestSnapshot:snapshot}).returning();
      await tx.insert(supplierInvoiceLines).values(values.map(l=>({...l,invoiceId:invoice.id})));
      await this.audit(tx,actor,"supplier_invoice.created",invoice.id);return this.detail(invoice.id,tx);
    });
  }
  async action(id:string,input:InvoiceAction,actor:AuthenticatedStaff) {
    this.privileged(actor);
    return this.db.transaction(async tx=>{
      const [header]=await tx.select().from(supplierInvoices).where(eq(supplierInvoices.id,id));
      if(!header) throw new NotFoundException("Supplier invoice not found");
      await tx.select().from(purchaseOrders).where(eq(purchaseOrders.id,header.purchaseOrderId)).for("update");
      const [invoice]=await tx.select().from(supplierInvoices).where(eq(supplierInvoices.id,id)).for("update");
      if(invoice.version!==input.version) throw new ConflictException("Invoice changed. Refresh before continuing.");
      if(input.action==="post") {
        if(invoice.status!=="draft") throw new BadRequestException("Only draft invoices can be posted");
        if(invoice.createdBy===actor.staffId) throw new ForbiddenException("Another super admin must post your invoice");
        const match=await this.match(invoice.purchaseOrderId,tx);
        const lines=await tx.select().from(supplierInvoiceLines).where(eq(supplierInvoiceLines.invoiceId,id));
        for(const l of lines) {const target=match.lines.find(p=>p.id===l.purchaseOrderLineId);
          if(!target||l.quantity>target.remaining) throw new ConflictException("Accepted quantities were invoiced elsewhere. Void this draft and create a corrected invoice.");}
        await tx.update(supplierInvoices).set({status:"posted",postedBy:actor.staffId,postedAt:new Date(),version:invoice.version+1}).where(eq(supplierInvoices.id,id));
      } else {
        if(input.reason.length<3) throw new BadRequestException("Provide a reason for voiding the invoice");
        if(invoice.status==="void") throw new BadRequestException("Invoice is already void");
        if(await this.paid(id,tx)>0n) throw new BadRequestException("Reverse the payment records before voiding an invoice");
        if(await this.credited(id,tx)>0n) throw new BadRequestException("Reverse posted credit notes before voiding an invoice");
        await tx.update(supplierInvoices).set({status:"void",voidedBy:actor.staffId,voidedAt:new Date(),voidReason:input.reason,version:invoice.version+1}).where(eq(supplierInvoices.id,id));
      }
      await this.audit(tx,actor,`supplier_invoice.${input.action}`,id,{reason:input.reason});return this.detail(id,tx);
    });
  }
  async pay(id:string,input:PaymentInput,actor:AuthenticatedStaff) {
    this.privileged(actor);
    if(input.paymentDate>today()) throw new BadRequestException("Record payments already made; payment date cannot be in the future");
    const snapshot={...input,invoiceId:id,actor:actor.staffId};
    return this.db.transaction(async tx=>{
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${input.operationId}))`);
      const [invoice]=await tx.select().from(supplierInvoices).where(eq(supplierInvoices.id,id)).for("update");
      if(!invoice) throw new NotFoundException("Supplier invoice not found");
      const [existing]=await tx.select().from(supplierPayments).where(eq(supplierPayments.operationId,input.operationId));
      if(existing) {if(canonical(existing.requestSnapshot)!==canonical(snapshot)) throw new ConflictException("Operation was already used for another payment");return this.detail(id,tx);}
      if(invoice.status!=="posted") throw new BadRequestException("Payments require a posted invoice");
      if(input.paymentDate<invoice.invoiceDate) throw new BadRequestException("Payment date cannot precede invoice date; supplier advances are not supported yet");
      const amount=nairaToKobo(input.amountNaira),remaining=invoice.totalKobo-await this.paid(id,tx)-await this.credited(id,tx);
      if(amount>remaining) throw new BadRequestException("Payment exceeds the outstanding invoice balance");
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`supplier-payment:${invoice.supplierId}:${input.reference.trim().toLowerCase()}`}))`);
      const [duplicate]=await tx.select({id:supplierPayments.id}).from(supplierPayments)
        .innerJoin(supplierInvoices,eq(supplierPayments.invoiceId,supplierInvoices.id))
        .leftJoin(supplierPaymentReversals,eq(supplierPaymentReversals.paymentId,supplierPayments.id))
        .where(and(eq(supplierInvoices.supplierId,invoice.supplierId),sql`lower(trim(${supplierPayments.reference}))=lower(trim(${input.reference}))`,sql`${supplierPaymentReversals.id} is null`));
      if(duplicate) throw new ConflictException("Payment reference is already recorded for this supplier");
      const [payment]=await tx.insert(supplierPayments).values({invoiceId:id,amountKobo:amount,paymentDate:input.paymentDate,method:input.method,reference:input.reference,notes:input.notes,recordedBy:actor.staffId,operationId:input.operationId,requestSnapshot:snapshot}).returning();
      await tx.update(supplierInvoices).set({version:invoice.version+1}).where(eq(supplierInvoices.id,id));
      await this.audit(tx,actor,"supplier_payment.recorded",id,{paymentId:payment.id});return this.detail(id,tx);
    });
  }
  async reverse(paymentId:string,reason:string,actor:AuthenticatedStaff) {
    this.privileged(actor);
    return this.db.transaction(async tx=>{
      const [payment]=await tx.select().from(supplierPayments).where(eq(supplierPayments.id,paymentId));
      if(!payment) throw new NotFoundException("Payment record not found");
      const [invoice]=await tx.select().from(supplierInvoices).where(eq(supplierInvoices.id,payment.invoiceId)).for("update");
      const [existing]=await tx.select().from(supplierPaymentReversals).where(eq(supplierPaymentReversals.paymentId,paymentId));
      if(existing) {if(existing.reason!==reason||existing.recordedBy!==actor.staffId)throw new ConflictException("Payment record was already reversed");return this.detail(invoice.id,tx);}
      await tx.insert(supplierPaymentReversals).values({paymentId,reason,recordedBy:actor.staffId});
      await tx.update(supplierInvoices).set({version:invoice.version+1}).where(eq(supplierInvoices.id,invoice.id));
      await this.audit(tx,actor,"supplier_payment.reversed",invoice.id,{paymentId,reason});return this.detail(invoice.id,tx);
    });
  }
  async createCredit(invoiceId:string,input:CreditInput,actor:AuthenticatedStaff) {
    if(input.creditDate>today())throw new BadRequestException("Credit date cannot be in the future");
    const snapshot={...input,invoiceId,actor:actor.staffId};
    return this.db.transaction(async tx=>{
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${input.operationId}))`);
      const [existing]=await tx.select().from(supplierCreditNotes).where(eq(supplierCreditNotes.operationId,input.operationId));
      if(existing){if(canonical(existing.requestSnapshot)!==canonical(snapshot))throw new ConflictException("Operation was already used for another credit note");return this.detail(invoiceId,tx);}
      const [invoice]=await tx.select().from(supplierInvoices).where(eq(supplierInvoices.id,invoiceId)).for("update");
      if(!invoice)throw new NotFoundException("Supplier invoice not found");
      if(invoice.status!=="posted")throw new BadRequestException("Credit notes require a posted invoice");
      if(input.creditDate<invoice.invoiceDate)throw new BadRequestException("Credit date cannot precede invoice date");
      const amount=nairaToKobo(input.amountNaira);
      if(amount>invoice.totalKobo-await this.credited(invoiceId,tx))throw new BadRequestException("Credit exceeds the invoice amount remaining to be credited");
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`supplier-credit:${invoice.supplierId}:${input.reference.trim().toLowerCase()}`}))`);
      const [duplicate]=await tx.select().from(supplierCreditNotes).where(and(eq(supplierCreditNotes.supplierId,invoice.supplierId),sql`lower(trim(${supplierCreditNotes.reference}))=lower(trim(${input.reference}))`));
      if(duplicate)throw new ConflictException("Supplier credit note reference is already recorded");
      const [credit]=await tx.insert(supplierCreditNotes).values({invoiceId,supplierId:invoice.supplierId,reference:input.reference,creditDate:input.creditDate,amountKobo:amount,reason:input.reason,createdBy:actor.staffId,operationId:input.operationId,requestSnapshot:snapshot}).returning();
      await this.audit(tx,actor,"supplier_credit.created",invoiceId,{creditNoteId:credit.id});return this.detail(invoiceId,tx);
    });
  }
  async creditAction(creditId:string,input:CreditAction,actor:AuthenticatedStaff) {
    this.privileged(actor);
    return this.db.transaction(async tx=>{
      const [header]=await tx.select().from(supplierCreditNotes).where(eq(supplierCreditNotes.id,creditId));
      if(!header)throw new NotFoundException("Credit note not found");
      const [invoice]=await tx.select().from(supplierInvoices).where(eq(supplierInvoices.id,header.invoiceId)).for("update");
      const [credit]=await tx.select().from(supplierCreditNotes).where(eq(supplierCreditNotes.id,creditId)).for("update");
      if(credit.version!==input.version)throw new ConflictException("Credit note changed. Refresh before continuing.");
      if(input.action==="post"){
        if(credit.status!=="draft")throw new BadRequestException("Only draft credit notes can be posted");
        if(credit.createdBy===actor.staffId)throw new ForbiddenException("Another super admin must post your credit note");
        if(invoice.status!=="posted")throw new BadRequestException("Credit notes require a posted invoice");
        if(credit.amountKobo>invoice.totalKobo-await this.credited(invoice.id,tx))throw new ConflictException("Other credit notes have used this invoice amount. Void this draft and prepare a corrected note.");
        await tx.update(supplierCreditNotes).set({status:"posted",postedBy:actor.staffId,postedAt:new Date(),version:credit.version+1}).where(eq(supplierCreditNotes.id,creditId));
      }else{
        if(input.reason.length<3)throw new BadRequestException("Provide a reason for correcting the credit note");
        if(input.action==="void"){
          if(credit.status!=="draft")throw new BadRequestException("Only drafts can be voided; reverse a posted credit note");
          await tx.update(supplierCreditNotes).set({status:"void",voidedBy:actor.staffId,voidReason:input.reason,version:credit.version+1}).where(eq(supplierCreditNotes.id,creditId));
        }else{
          if(credit.status!=="posted")throw new BadRequestException("Only posted credit notes can be reversed");
          const [existing]=await tx.select().from(supplierCreditReversals).where(eq(supplierCreditReversals.creditNoteId,creditId));
          if(existing){if(existing.reason!==input.reason||existing.recordedBy!==actor.staffId)throw new ConflictException("Credit note was already reversed");return this.detail(invoice.id,tx);}
          await tx.insert(supplierCreditReversals).values({creditNoteId:creditId,reason:input.reason,recordedBy:actor.staffId});
        }
      }
      await tx.update(supplierInvoices).set({version:invoice.version+1}).where(eq(supplierInvoices.id,invoice.id));
      await this.audit(tx,actor,`supplier_credit.${input.action}`,invoice.id,{creditNoteId:creditId,reason:input.reason});return this.detail(invoice.id,tx);
    });
  }
}
