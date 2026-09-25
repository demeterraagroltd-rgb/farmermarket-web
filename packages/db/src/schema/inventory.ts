import { bigint, bigserial, check, date, index, integer, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { staff } from "./identity.js";
import { products, vendors } from "./catalog.js";
import { orders } from "./commerce.js";

// Inventory, phase 1: one central warehouse, head-office admins only.
//
// The running totals live on `products` (`stock_quantity` = on hand,
// `stock_reserved` = held for orders not yet dispatched), so the buyer-facing
// availability read stays a single-table query. Everything that changes them
// is written here too — the same "balances + append-only journal" split the
// money ledger uses — and InventoryService is the only writer of either.

// One delivery of one product. Dispatch consumes lots oldest-received first
// (FIFO); `quantity_remaining` summed over a product's lots always equals
// `products.stock_quantity`.
export const stockLots = pgTable(
  "stock_lots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    productId: uuid("product_id").notNull().references(() => products.id),
    // Human reference printed on the pick list, e.g. "RICE-240925-1".
    lotCode: text("lot_code").notNull().unique(),
    quantityReceived: integer("quantity_received").notNull(),
    quantityRemaining: integer("quantity_remaining").notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
    expiryDate: date("expiry_date"), // null = doesn't expire (or not recorded)
    unitCostKobo: bigint("unit_cost_kobo", { mode: "bigint" }),
    vendorId: uuid("vendor_id").references(() => vendors.id),
    note: text("note"),
    createdByStaffId: uuid("created_by_staff_id").references(() => staff.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("lot_received_positive", sql`${table.quantityReceived} > 0`),
    check(
      "lot_remaining_in_range",
      sql`${table.quantityRemaining} >= 0 AND ${table.quantityRemaining} <= ${table.quantityReceived}`,
    ),
    index("stock_lots_fifo_idx").on(table.productId, table.receivedAt),
  ],
);

export const stockMovementTypeEnum = pgEnum("stock_movement_type", [
  "receive", // goods in from a vendor (or the opening balance)
  "reserve", // buyer submitted an order
  "release", // order rejected / cancelled / expired before dispatch
  "dispatch", // order left the warehouse for its pickup centre
  "return", // dispatched order cancelled — goods came back to their lot
  "adjust", // damage, spoilage, count correction
]);

// Never updated or deleted. Each row carries signed deltas, so the totals on
// `products` are always reproducible: on hand = Σ on_hand_delta, reserved =
// Σ reserved_delta. Lot-level rows (receive/dispatch/return/adjust) name the
// lot; reserve/release are product-level and don't.
export const stockMovements = pgTable(
  "stock_movements",
  {
    id: bigserial("id", { mode: "bigint" }).primaryKey(),
    productId: uuid("product_id").notNull().references(() => products.id),
    lotId: uuid("lot_id").references(() => stockLots.id),
    type: stockMovementTypeEnum("type").notNull(),
    onHandDelta: integer("on_hand_delta").notNull().default(0),
    reservedDelta: integer("reserved_delta").notNull().default(0),
    orderId: uuid("order_id").references(() => orders.id),
    // Adjustments only: 'damage' | 'spoilage' | 'count_correction' | 'other'.
    reason: text("reason"),
    note: text("note"),
    staffId: uuid("staff_id").references(() => staff.id), // null = system (buyer checkout, cron)
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("movement_nonzero", sql`${table.onHandDelta} <> 0 OR ${table.reservedDelta} <> 0`),
    index("stock_movements_product_idx").on(table.productId, table.createdAt),
    index("stock_movements_order_idx").on(table.orderId),
  ],
);
