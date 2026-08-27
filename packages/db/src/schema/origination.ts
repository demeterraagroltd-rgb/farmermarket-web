import { bigint, char, check, date, jsonb, numeric, pgEnum, pgTable, smallint, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { users, staff } from "./identity.js";

export const applicationStatusEnum = pgEnum("application_status", [
  "draft", "submitted", "auto_checks", "info_required", "credit_review",
  "escalated", "approved", "auto_declined", "declined",
  "offer_issued", "offer_accepted", "offer_expired", "limit_active", "withdrawn",
]);

export const applications = pgTable(
  "applications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    reference: text("reference").notNull().unique(), // 'FM-2026-04821'
    userId: uuid("user_id").references(() => users.id),
    status: applicationStatusEnum("status").notNull().default("draft"),
    channel: text("channel").notNull(), // 'web' | 'sales' | 'app'
    ownerStaffId: uuid("owner_staff_id").references(() => staff.id),

    fullName: text("full_name").notNull(),
    email: text("email"),
    phone: text("phone").notNull(),
    dateOfBirth: date("date_of_birth"),
    bvnHash: text("bvn_hash"), // bytea in Postgres proper; text placeholder pending KMS design (§13)
    bvnLast4: char("bvn_last4", { length: 4 }),
    address: jsonb("address"),

    employer: text("employer"),
    employmentType: text("employment_type"), // 'Government' | 'Private'
    jobTitle: text("job_title"),
    netMonthlySalaryKobo: bigint("net_monthly_salary_kobo", { mode: "bigint" }),
    salaryDay: smallint("salary_day"),
    yearsEmployed: numeric("years_employed", { precision: 4, scale: 1 }),
    employerVerified: text("employer_verified").default("false"),

    bankName: text("bank_name"),
    accountLast4: char("account_last4", { length: 4 }),
    monoAccountId: text("mono_account_id"),
    requestedLimitKobo: bigint("requested_limit_kobo", { mode: "bigint" }),
    preferredPlanId: uuid("preferred_plan_id"),

    flags: text("flags").array().notNull().default(sql`'{}'::text[]`),
    slaDueAt: timestamp("sla_due_at", { withTimezone: true }),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("salary_day_range", sql`${table.salaryDay} BETWEEN 1 AND 31`),
    check("net_salary_non_negative", sql`${table.netMonthlySalaryKobo} >= 0`),
    check("requested_limit_positive", sql`${table.requestedLimitKobo} > 0`),
    // Postgres partial unique index: one live application per person (§5.2).
    uniqueIndex("one_open_application_per_user")
      .on(table.userId)
      .where(sql`${table.status} NOT IN ('declined','auto_declined','withdrawn','limit_active','offer_expired')`),
  ],
);

export const applicationDecisions = pgTable(
  "application_decisions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    applicationId: uuid("application_id").notNull().references(() => applications.id),
    outcome: text("outcome").notNull(), // 'approved' | 'declined' | 'referred'
    approvedLimitKobo: bigint("approved_limit_kobo", { mode: "bigint" }),
    tier: text("tier"),
    reasonCodes: text("reason_codes").array().notNull().default(sql`'{}'::text[]`),
    notes: text("notes"),
    decidedBy: uuid("decided_by").notNull().references(() => staff.id),
    scorecardRunId: uuid("scorecard_run_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check(
      "decline_needs_reason",
      sql`${table.outcome} <> 'declined' OR cardinality(${table.reasonCodes}) > 0`,
    ),
  ],
);

// Every transition writes here — actor, from, to, timestamp, reason.
// The queue view, SLA clock, and audit trail all read from this one table (§7).
export const applicationEvents = pgTable("application_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  applicationId: uuid("application_id").notNull().references(() => applications.id),
  actorStaffId: uuid("actor_staff_id").references(() => staff.id),
  fromStatus: applicationStatusEnum("from_status"),
  toStatus: applicationStatusEnum("to_status").notNull(),
  reason: text("reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
