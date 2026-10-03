import { bigint, check, integer, jsonb, pgTable, serial, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { products, vendors } from "./catalog.js";
import { staff } from "./identity.js";
import { pickupCenters } from "./commerce.js";

export const purchaseOrders = pgTable("purchase_orders", {
  id: uuid("id").primaryKey().defaultRandom(),
  sequence: serial("sequence").notNull().unique(),
  supplierId: uuid("supplier_id").notNull().references(() => vendors.id),
  supplierName: text("supplier_name").notNull(),
  warehouseId: uuid("warehouse_id").notNull().references(() => pickupCenters.id),
  warehouseName: text("warehouse_name").notNull(),
  status: text("status").notNull().default("draft"),
  notes: text("notes").notNull().default(""),
  version: integer("version").notNull().default(1),
  createdBy: uuid("created_by").notNull().references(() => staff.id),
  approvedBy: uuid("approved_by").references(() => staff.id),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  closedReason: text("closed_reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [check("purchase_order_status", sql`${t.status} in ('draft','submitted','approved','partially_received','fully_received','closed','cancelled')`),
  check("purchase_order_separate_approver", sql`${t.approvedBy} IS NULL OR ${t.approvedBy} <> ${t.createdBy}`)]);

export const purchaseOrderLines = pgTable("purchase_order_lines", {
  id: uuid("id").primaryKey().defaultRandom(),
  purchaseOrderId: uuid("purchase_order_id").notNull().references(() => purchaseOrders.id),
  productId: uuid("product_id").notNull().references(() => products.id),
  productName: text("product_name").notNull(),
  unit: text("unit").notNull(),
  quantity: integer("quantity").notNull(),
  unitCostKobo: bigint("unit_cost_kobo", {mode:"bigint"}).notNull(),
}, t => [check("purchase_line_quantity", sql`${t.quantity} > 0`), check("purchase_line_cost", sql`${t.unitCostKobo} > 0`)]);

export const goodsReceipts = pgTable("goods_receipts", {
  id: uuid("id").primaryKey().defaultRandom(),
  sequence: serial("sequence").notNull().unique(),
  purchaseOrderId: uuid("purchase_order_id").notNull().references(() => purchaseOrders.id),
  deliveryReference: text("delivery_reference").notNull(),
  warehouseId: uuid("warehouse_id").notNull().references(() => pickupCenters.id),
  notes: text("notes").notNull().default(""),
  receivedBy: uuid("received_by").notNull().references(() => staff.id),
  operationId: uuid("operation_id").notNull().unique(),
  requestSnapshot: jsonb("request_snapshot").notNull(),
  createdAt: timestamp("created_at", {withTimezone:true}).notNull().defaultNow(),
});
export const goodsReceiptLines = pgTable("goods_receipt_lines", {
  id: uuid("id").primaryKey().defaultRandom(),
  receiptId: uuid("receipt_id").notNull().references(() => goodsReceipts.id),
  purchaseOrderLineId: uuid("purchase_order_line_id").notNull().references(() => purchaseOrderLines.id),
  accepted: integer("accepted").notNull(),
  rejected: integer("rejected").notNull().default(0),
}, t => [check("receipt_line_quantities", sql`${t.accepted} >= 0 AND ${t.rejected} >= 0 AND ${t.accepted} + ${t.rejected} > 0`)]);
