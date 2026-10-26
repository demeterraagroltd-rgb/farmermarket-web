import { pgTable, uuid, text, timestamp, jsonb, integer, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { users } from "./identity.js";
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
