import { jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { staff } from "./identity";

// One row per privileged action: decisions, limit changes, role changes,
// PII unmasking, exports, publishes (§13). Append-only — UPDATE/DELETE
// revoked from the application role in the manual migration.
export const auditLogs = pgTable("audit_logs", {
  id: uuid("id").primaryKey().defaultRandom(),
  actorStaffId: uuid("actor_staff_id").references(() => staff.id),
  action: text("action").notNull(),
  targetType: text("target_type"),
  targetId: text("target_id"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const webhookEvents = pgTable("webhook_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  source: text("source").notNull(), // 'mono' | 'firstcentral' | ...
  eventId: text("event_id").notNull().unique(), // dedupe key
  payload: jsonb("payload").notNull(),
  processedAt: timestamp("processed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
