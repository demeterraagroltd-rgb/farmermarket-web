import { check, bigint, pgTable, smallint, text, timestamp, uuid, boolean } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { users } from "./identity";
import { staff } from "./identity";

// What the phone app reads. `withinLimit` is what makes over-spending
// structurally impossible — Firestore could not express this (§5.3).
export const creditProfiles = pgTable(
  "credit_profiles",
  {
    userId: uuid("user_id").primaryKey().references(() => users.id),
    creditLimitKobo: bigint("credit_limit_kobo", { mode: "bigint" }).notNull().default(0n),
    usedCreditKobo: bigint("used_credit_kobo", { mode: "bigint" }).notNull().default(0n),
    tier: text("tier").notNull().default("None"),
    score: smallint("score"),
    isVerified: boolean("is_verified").notNull().default(false),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("credit_limit_non_negative", sql`${table.creditLimitKobo} >= 0`),
    check("used_credit_non_negative", sql`${table.usedCreditKobo} >= 0`),
    check("score_range", sql`${table.score} BETWEEN 300 AND 850`),
    check("within_limit", sql`${table.usedCreditKobo} <= ${table.creditLimitKobo}`),
  ],
);

// Append-only audit trail for every limit change — actor, before, after, reason.
export const creditLimitChanges = pgTable("credit_limit_changes", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id),
  beforeKobo: bigint("before_kobo", { mode: "bigint" }).notNull(),
  afterKobo: bigint("after_kobo", { mode: "bigint" }).notNull(),
  reason: text("reason").notNull(),
  actorStaffId: uuid("actor_staff_id").references(() => staff.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
