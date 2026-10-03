import { sql } from "drizzle-orm";
import { check, index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { products } from "./catalog.js";
import { staff } from "./identity.js";
import { orders, pickupCenters } from "./commerce.js";
import { goodsReceipts } from "./purchasing.js";

export const inventoryMovements = pgTable("inventory_movements", {
  id: uuid("id").primaryKey().defaultRandom(),
  productId: uuid("product_id").notNull().references(() => products.id),
  productName: text("product_name").notNull(),
  kind: text("kind").notNull(),
  availableDelta: integer("available_delta").notNull(),
  reservedDelta: integer("reserved_delta").notNull().default(0),
  availableBefore: integer("available_before").notNull(),
  availableAfter: integer("available_after").notNull(),
  reason: text("reason").notNull(),
  reference: text("reference"),
  actorStaffId: uuid("actor_staff_id").references(() => staff.id),
  orderId: uuid("order_id").references(() => orders.id),
  receiptId: uuid("receipt_id").references(() => goodsReceipts.id),
  warehouseId: uuid("warehouse_id").references(() => pickupCenters.id),
  eventKey: text("event_key").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("inventory_product_date_idx").on(t.productId, t.createdAt),
  check("inventory_available_nonnegative", sql`${t.availableBefore} >= 0 AND ${t.availableAfter} >= 0`),
  check("inventory_movement_balanced", sql`${t.availableAfter} = ${t.availableBefore} + ${t.availableDelta}`),
  check("inventory_movement_kind", sql`${t.kind} IN ('opening', 'receive', 'adjustment', 'reservation', 'release', 'fulfilment', 'allocation', 'transfer', 'count')`)]);
