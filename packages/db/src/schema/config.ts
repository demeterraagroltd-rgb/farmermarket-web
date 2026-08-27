import { jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

// Small key/value table read by both apps and cached — `fees`, `credit_policy`,
// `feature_flags`. Changing the service fee becomes a dashboard edit rather
// than an app release (§5.7).
export const config = pgTable("config", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
