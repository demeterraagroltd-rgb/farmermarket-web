import { bigint, boolean, check, integer, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { users, staff } from "./identity.js";
import { bnplPlans, products } from "./catalog.js";

export const orderStatusEnum = pgEnum("order_status", [
  // A verified buyer's order lands here first; a staff member approves it
  // (→ confirmed, which is when credit is actually debited) or rejects it.
  "pending_approval",
  "rejected",
  "placed", "confirmed", "preparing", "on_the_way", "delivered", "cancelled",
]);

// §5.1 commerce domain, §14 — the Flutter app's `Order` model this mirrors
// (lib/features/orders/domain/models/order.dart) is naira/double; this
// stores kobo/bigint per §5's money rule, and the API converts at the edge.
export const orders = pgTable(
  "orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id),
    // DB default stays "placed" (legacy); every insert path sets `status`
    // explicitly — buyer-placed orders start "pending_approval", staff/seed
    // paths pass their own. Changing an enum's DB default in the same
    // migration that adds the value isn't transaction-safe in Postgres.
    status: orderStatusEnum("status").notNull().default("placed"),
    subtotalKobo: bigint("subtotal_kobo", { mode: "bigint" }).notNull(),
    // A raw bigint literal default (0n) isn't JSON-serializable, which
    // crashes drizzle-kit's schema snapshot diffing outright — same issue
    // already hit and fixed in schema/credit.ts. Use a SQL default instead.
    deliveryFeeKobo: bigint("delivery_fee_kobo", { mode: "bigint" }).notNull().default(sql`0`),
    serviceFeeKobo: bigint("service_fee_kobo", { mode: "bigint" }).notNull().default(sql`0`),
    totalKobo: bigint("total_kobo", { mode: "bigint" }).notNull(),
    bnplPlanId: uuid("bnpl_plan_id").notNull().references(() => bnplPlans.id),
    deliveryAddress: text("delivery_address").notNull(),
    placedAt: timestamp("placed_at", { withTimezone: true }).notNull().defaultNow(),
    estimatedDeliveryAt: timestamp("estimated_delivery_at", { withTimezone: true }),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    // Set when a staff member approves the order (status → confirmed).
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    approvedByStaffId: uuid("approved_by_staff_id").references(() => staff.id),
    deliverySlot: text("delivery_slot"), // human string shown to the buyer, e.g. "Tue 3 Sep, 9am–12pm"
    rejectionReason: text("rejection_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [check("total_positive", sql`${table.totalKobo} > 0`)],
);

// Snapshots name/image/price at time of purchase — a later product edit or
// deletion must never change what a past order shows (§10 catalog, product
// history integrity).
export const orderItems = pgTable("order_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  orderId: uuid("order_id").notNull().references(() => orders.id),
  productId: uuid("product_id").references(() => products.id),
  name: text("name").notNull(),
  imageUrl: text("image_url").notNull(),
  quantity: integer("quantity").notNull(),
  unitPriceKobo: bigint("unit_price_kobo", { mode: "bigint" }).notNull(),
});

// One row per installment. Generated from the order's bnpl plan at
// placement time — matches the Dart `RepaymentSchedule` model
// (installmentNumber/totalInstallments/amount/amountPaid/dueDate).
export const repaymentSchedules = pgTable(
  "repayment_schedules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id").notNull().references(() => orders.id),
    userId: uuid("user_id").notNull().references(() => users.id),
    installmentNumber: integer("installment_number").notNull(),
    totalInstallments: integer("total_installments").notNull(),
    amountKobo: bigint("amount_kobo", { mode: "bigint" }).notNull(),
    amountPaidKobo: bigint("amount_paid_kobo", { mode: "bigint" }).notNull().default(sql`0`),
    dueDate: timestamp("due_date", { withTimezone: true }).notNull(),
    isPaid: boolean("is_paid").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("amount_positive", sql`${table.amountKobo} > 0`),
    check("paid_not_over_amount", sql`${table.amountPaidKobo} <= ${table.amountKobo}`),
  ],
);

// Append-only — each repayment call writes one row here, never mutates a
// prior one. `repayment_schedules.amountPaidKobo`/`isPaid` are the
// derived/current-state view; this is the audit trail behind it.
export const repayments = pgTable(
  "repayments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    repaymentScheduleId: uuid("repayment_schedule_id").notNull().references(() => repaymentSchedules.id),
    amountKobo: bigint("amount_kobo", { mode: "bigint" }).notNull(),
    paidAt: timestamp("paid_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [check("amount_positive", sql`${table.amountKobo} > 0`)],
);
