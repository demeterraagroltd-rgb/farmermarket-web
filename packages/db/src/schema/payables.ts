import { bigint, check, date, integer, jsonb, pgTable, serial, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { vendors } from "./catalog.js";
import { staff } from "./identity.js";
import { purchaseOrders, purchaseOrderLines } from "./purchasing.js";

export const supplierInvoices = pgTable("supplier_invoices", {
  id: uuid("id").primaryKey().defaultRandom(),
  sequence: serial("sequence").notNull().unique(),
  purchaseOrderId: uuid("purchase_order_id").notNull().references(() => purchaseOrders.id),
  supplierId: uuid("supplier_id").notNull().references(() => vendors.id),
  supplierName: text("supplier_name").notNull(),
  reference: text("reference").notNull(),
  invoiceDate: date("invoice_date").notNull(),
  dueDate: date("due_date").notNull(),
  notes: text("notes").notNull().default(""),
  status: text("status").notNull().default("draft"),
  totalKobo: bigint("total_kobo", {mode:"bigint"}).notNull(),
  version: integer("version").notNull().default(1),
  createdBy: uuid("created_by").notNull().references(() => staff.id),
  postedBy: uuid("posted_by").references(() => staff.id),
  postedAt: timestamp("posted_at", {withTimezone:true}),
  voidedBy: uuid("voided_by").references(() => staff.id),
  voidReason: text("void_reason"),
  voidedAt: timestamp("voided_at", {withTimezone:true}),
  operationId: uuid("operation_id").notNull().unique(),
  requestSnapshot: jsonb("request_snapshot").notNull(),
  createdAt: timestamp("created_at", {withTimezone:true}).notNull().defaultNow(),
}, t => [
  uniqueIndex("supplier_invoice_reference_unique").on(t.supplierId, sql`lower(trim(${t.reference}))`),
  check("supplier_invoice_status", sql`${t.status} in ('draft','posted','void')`),
  check("supplier_invoice_positive", sql`${t.totalKobo} > 0`),
  check("supplier_invoice_dates", sql`${t.dueDate} >= ${t.invoiceDate}`),
  check("supplier_invoice_separate_poster", sql`${t.postedBy} IS NULL OR ${t.postedBy} <> ${t.createdBy}`),
]);

export const supplierInvoiceLines = pgTable("supplier_invoice_lines", {
  id: uuid("id").primaryKey().defaultRandom(),
  invoiceId: uuid("invoice_id").notNull().references(() => supplierInvoices.id),
  purchaseOrderLineId: uuid("purchase_order_line_id").notNull().references(() => purchaseOrderLines.id),
  productName: text("product_name").notNull(),
  unit: text("unit").notNull(),
  quantity: integer("quantity").notNull(),
  unitCostKobo: bigint("unit_cost_kobo", {mode:"bigint"}).notNull(),
}, t => [uniqueIndex("supplier_invoice_line_unique").on(t.invoiceId,t.purchaseOrderLineId),
  check("supplier_invoice_line_positive", sql`${t.quantity} > 0 AND ${t.unitCostKobo} > 0`)]);

// These are records of payments made elsewhere; no bank transfer is initiated.
export const supplierPayments = pgTable("supplier_payments", {
  id: uuid("id").primaryKey().defaultRandom(),
  sequence: serial("sequence").notNull().unique(),
  invoiceId: uuid("invoice_id").notNull().references(() => supplierInvoices.id),
  amountKobo: bigint("amount_kobo", {mode:"bigint"}).notNull(),
  paymentDate: date("payment_date").notNull(),
  method: text("method").notNull(),
  reference: text("reference").notNull(),
  notes: text("notes").notNull().default(""),
  recordedBy: uuid("recorded_by").notNull().references(() => staff.id),
  operationId: uuid("operation_id").notNull().unique(),
  requestSnapshot: jsonb("request_snapshot").notNull(),
  createdAt: timestamp("created_at", {withTimezone:true}).notNull().defaultNow(),
}, t => [check("supplier_payment_positive", sql`${t.amountKobo} > 0`),
  check("supplier_payment_method", sql`${t.method} in ('bank_transfer','cash','cheque','other')`)]);

export const supplierPaymentReversals = pgTable("supplier_payment_reversals", {
  id: uuid("id").primaryKey().defaultRandom(),
  paymentId: uuid("payment_id").notNull().unique().references(() => supplierPayments.id),
  reason: text("reason").notNull(),
  recordedBy: uuid("recorded_by").notNull().references(() => staff.id),
  createdAt: timestamp("created_at", {withTimezone:true}).notNull().defaultNow(),
});

export const supplierCreditNotes = pgTable("supplier_credit_notes", {
  id: uuid("id").primaryKey().defaultRandom(),
  sequence: serial("sequence").notNull().unique(),
  invoiceId: uuid("invoice_id").notNull().references(() => supplierInvoices.id),
  supplierId: uuid("supplier_id").notNull().references(() => vendors.id),
  reference: text("reference").notNull(),
  creditDate: date("credit_date").notNull(),
  amountKobo: bigint("amount_kobo", {mode:"bigint"}).notNull(),
  reason: text("reason").notNull(),
  status: text("status").notNull().default("draft"),
  version: integer("version").notNull().default(1),
  createdBy: uuid("created_by").notNull().references(() => staff.id),
  postedBy: uuid("posted_by").references(() => staff.id),
  postedAt: timestamp("posted_at", {withTimezone:true}),
  voidedBy: uuid("voided_by").references(() => staff.id),
  voidReason: text("void_reason"),
  operationId: uuid("operation_id").notNull().unique(),
  requestSnapshot: jsonb("request_snapshot").notNull(),
  createdAt: timestamp("created_at", {withTimezone:true}).notNull().defaultNow(),
}, t => [uniqueIndex("supplier_credit_reference_unique").on(t.supplierId,sql`lower(trim(${t.reference}))`),
  check("supplier_credit_positive",sql`${t.amountKobo} > 0`),
  check("supplier_credit_status",sql`${t.status} in ('draft','posted','void')`),
  check("supplier_credit_separate_poster",sql`${t.postedBy} IS NULL OR ${t.postedBy} <> ${t.createdBy}`)]);

export const supplierCreditReversals = pgTable("supplier_credit_reversals", {
  id: uuid("id").primaryKey().defaultRandom(),
  creditNoteId: uuid("credit_note_id").notNull().unique().references(() => supplierCreditNotes.id),
  reason: text("reason").notNull(),
  recordedBy: uuid("recorded_by").notNull().references(() => staff.id),
  createdAt: timestamp("created_at", {withTimezone:true}).notNull().defaultNow(),
});
