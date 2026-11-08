import { pgTable, uuid, text, timestamp, jsonb, integer, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { users, staff } from "./identity.js";
import { bigint, uniqueIndex } from "drizzle-orm/pg-core";
import { orders } from "./commerce.js";

// One production consent intent per financed order. An uncertain submission
// remains recorded so a restart or double click cannot submit it again.
export const recovaConsents = pgTable("recova_consents", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id),
  orderId: uuid("order_id").notNull().unique().references(() => orders.id),
  reference: text("reference").notNull().unique(),
  status: text("status").notNull().default("draft"),
  purpose: text("purpose").notNull(),
  bankCode: text("bank_code").notNull(),
  accountLast4: text("account_last4").notNull(),
  payloadEncrypted: text("payload_encrypted").notNull(),
  approvalUrlEncrypted: text("approval_url_encrypted"),
  scheduleSnapshot: jsonb("schedule_snapshot").notNull(),
  consentVersion: text("consent_version").notNull(),
  consentedAt: timestamp("consented_at", { withTimezone: true }).notNull().defaultNow(),
  submittedAt: timestamp("submitted_at", { withTimezone: true }),
  checkedAt: timestamp("checked_at", { withTimezone: true }),
  httpStatus: integer("http_status"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [
  check("recova_status_valid", sql`${t.status} in ('draft','submitting','awaiting_consent','processing','active','failed','needs_review','cancelled','expired')`),
  check("recova_purpose_valid", sql`${t.purpose} in ('Collection','Recovery')`),
]);

// Minimal callback receipt. No raw BVNs, account numbers, messages or URLs.
export const recovaCallbacks = pgTable("recova_callbacks", {
  eventKey: text("event_key").primaryKey(),
  reference: text("reference").notNull().references(() => recovaConsents.reference),
  kind: text("kind").notNull(),
  outcome: text("outcome").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Staff reports are unverified evidence, never provider events or ledger payments.
export const recovaPaymentReports = pgTable("recova_payment_reports", {
  id: uuid("id").primaryKey().defaultRandom(),
  reference: text("reference").notNull().references(() => recovaConsents.reference),
  channel: text("channel").notNull(),
  sourceName: text("source_name").notNull(),
  transactionReference: text("transaction_reference").notNull(),
  amountKobo: bigint("amount_kobo", { mode: "bigint" }).notNull(),
  observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
  note: text("note").notNull().default(""),
  status: text("status").notNull().default("needs_verification"),
  reportedByStaffId: uuid("reported_by_staff_id").notNull().references(() => staff.id),
  reportedAt: timestamp("reported_at", { withTimezone: true }).notNull().defaultNow(),
  dismissedByStaffId: uuid("dismissed_by_staff_id").references(() => staff.id),
  dismissedAt: timestamp("dismissed_at", { withTimezone: true }),
  dismissalReason: text("dismissal_reason"),
}, t => [
  uniqueIndex("recova_report_source_transaction_unique").on(t.sourceName, t.transactionReference).where(sql`${t.status} = 'needs_verification'`),
  check("recova_report_amount_positive", sql`${t.amountKobo} > 0`),
  check("recova_report_status_valid", sql`${t.status} in ('needs_verification','dismissed')`),
  check("recova_report_channel_valid", sql`${t.channel} in ('collection','recovery','voluntary')`),
]);
