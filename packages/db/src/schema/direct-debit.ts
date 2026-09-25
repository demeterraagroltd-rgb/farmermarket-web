import {
  bigint,
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { users } from "./identity.js";
import { repaymentSchedules, repayments } from "./commerce.js";
import { bankAccounts } from "./mono.js";

// Auto-debit: a customer authorises a Mono *variable* direct-debit mandate on
// their bank account once; we then debit each installment on its due date.
//
// Money rules this schema exists to enforce (the service relies on them, it
// does not re-implement them):
//  - one *live* mandate per customer (partial unique index);
//  - one *in-flight* debit attempt per installment (partial unique index) — the
//    database, not application timing, is what stops a double debit;
//  - one repayment per attempt (unique repayment_id) — a webhook delivered
//    twice can never record the same money twice.

export const debitMandateStatusEnum = pgEnum("debit_mandate_status", [
  "awaiting_authorisation", // created; the customer hasn't approved it at their bank yet
  "approved", // the bank approved it, but Mono hasn't marked it ready to debit
  "active", // ready to debit
  "paused",
  "cancelled",
  "rejected",
  "expired",
]);

// Mono's customer id for one of ours. Kept so we never create a second Mono
// customer for the same person (Mono rejects that as "Customer already exists",
// and the id can't be looked up again from our side).
export const monoCustomers = pgTable("mono_customers", {
  userId: uuid("user_id").primaryKey().references(() => users.id),
  monoCustomerId: text("mono_customer_id").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const debitMandates = pgTable(
  "debit_mandates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id),
    bankAccountId: uuid("bank_account_id").references(() => bankAccounts.id),
    monoCustomerId: text("mono_customer_id").notNull(),
    // Known once Mono tells us (the approval webhook); until then the
    // `reference` we sent is how an event is matched to this row.
    monoMandateId: text("mono_mandate_id").unique(),
    reference: text("reference").notNull().unique(),
    status: debitMandateStatusEnum("status").notNull().default("awaiting_authorisation"),
    // The most we may collect over the mandate's life, and how much we have.
    // What the customer agreed to — never exceeded (see debit-policy.ts).
    amountKobo: bigint("amount_kobo", { mode: "bigint" }).notNull(),
    collectedKobo: bigint("collected_kobo", { mode: "bigint" }).notNull().default(sql`0`),
    startDate: timestamp("start_date", { withTimezone: true }).notNull(),
    endDate: timestamp("end_date", { withTimezone: true }).notNull(),
    authorisationUrl: text("authorisation_url"),
    statusReason: text("status_reason"),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    readyAt: timestamp("ready_at", { withTimezone: true }),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("debit_mandates_amount_positive", sql`${t.amountKobo} > 0`),
    check("debit_mandates_collected_within_cap", sql`${t.collectedKobo} >= 0 AND ${t.collectedKobo} <= ${t.amountKobo}`),
    // At most one mandate per customer that could still debit or be authorised.
    uniqueIndex("debit_mandates_one_live_per_user")
      .on(t.userId)
      .where(sql`${t.status} in ('awaiting_authorisation', 'approved', 'active', 'paused')`),
    index("debit_mandates_user_idx").on(t.userId, t.createdAt),
  ],
);

export const debitAttemptStatusEnum = pgEnum("debit_attempt_status", [
  "initiated", // recorded, not yet handed to Mono
  "processing", // Mono accepted it; the bank hasn't confirmed
  "successful",
  "failed",
  // Money may have moved without us being able to record it (it arrived after
  // the installment was paid another way, or we lost track of the request).
  // Never retried automatically; a person resolves it.
  "needs_review",
]);

export const debitAttempts = pgTable(
  "debit_attempts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    repaymentScheduleId: uuid("repayment_schedule_id").notNull().references(() => repaymentSchedules.id),
    mandateId: uuid("mandate_id").notNull().references(() => debitMandates.id),
    userId: uuid("user_id").notNull().references(() => users.id),
    attemptNumber: integer("attempt_number").notNull(),
    // Sent to Mono as the debit's unique reference. Unique here too, so the
    // same attempt can never be sent under two references or two attempts under one.
    reference: text("reference").notNull().unique(),
    amountKobo: bigint("amount_kobo", { mode: "bigint" }).notNull(),
    status: debitAttemptStatusEnum("status").notNull().default("initiated"),
    trigger: text("trigger").notNull().default("scheduled"), // 'scheduled' | 'manual'
    // Mono's own reference/session for the debit, to match a later webhook.
    providerReference: text("provider_reference"),
    responseCode: text("response_code"), // "00" ok, "51" insufficient funds, ...
    failureReason: text("failure_reason"),
    feeKobo: bigint("fee_kobo", { mode: "bigint" }),
    // Set the instant before the request leaves us. An attempt that has it but
    // no outcome may have reached Mono, so it is reviewed, not silently retried.
    sentAt: timestamp("sent_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    repaymentId: uuid("repayment_id").references(() => repayments.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("debit_attempts_amount_positive", sql`${t.amountKobo} > 0`),
    // The double-debit guard: a second in-flight attempt for the same
    // installment fails at the database, however the two calls raced.
    uniqueIndex("debit_attempts_one_open_per_schedule")
      .on(t.repaymentScheduleId)
      .where(sql`${t.status} in ('initiated', 'processing')`),
    // One recorded repayment per attempt, ever.
    uniqueIndex("debit_attempts_repayment_uidx").on(t.repaymentId).where(sql`${t.repaymentId} is not null`),
    index("debit_attempts_schedule_idx").on(t.repaymentScheduleId, t.createdAt),
    index("debit_attempts_user_idx").on(t.userId, t.createdAt),
  ],
);
