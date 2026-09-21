import {
  bigint,
  boolean,
  char,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { staff, users } from "./identity.js";

// Persistent Mono data (§9.1). Everything Mono tells us about a customer is
// kept here as queryable columns, so a credit decision can reuse it instead of
// re-asking the bank, and so we can say exactly what we knew and when.
//
// Conventions every table below follows:
//  - `userId` is the customer; `monoAccountId` (where it applies) is Mono's own
//    id, denormalised next to our `bankAccountId` so support can search by it.
//  - `retrievedAt` is when the *provider* data was fetched — distinct from
//    `createdAt`/`updatedAt`, which are about our row. Freshness is computed
//    from `retrievedAt` at read time; it decays, so it is never stored.
//  - `dataVersion` versions our normalisation of the provider's response. When
//    the mapping changes, old rows stay interpretable.
//  - The raw provider response is kept (encrypted, expiring) in
//    `mono_raw_responses`; other rows point at it through `syncLogId`.
//  - Append-only where history matters (summaries, income, identity checks,
//    logs): a new sync adds a row rather than overwriting the last one.

/** Bumped when how we normalise Mono's responses changes. */
export const MONO_DATA_VERSION = 1;

export const bankAccountStatusEnum = pgEnum("bank_account_status", [
  "active",
  "disconnected", // the customer revoked, or Mono reported the link gone
  "reauth_required", // the bank wants the customer to sign in again
]);

// One row per linked bank account. A customer can link more than one; the
// legacy `applicant_profiles.mono_account_id` still names the primary and is
// kept in step until nothing reads it.
export const bankAccounts = pgTable(
  "bank_accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id),
    monoAccountId: text("mono_account_id").notNull().unique(),
    institution: text("institution"),
    accountName: text("account_name"),
    // Last four only. The full number is never stored — we have no use for it.
    accountNumberLast4: char("account_number_last4", { length: 4 }),
    currency: text("currency").notNull().default("NGN"),
    accountType: text("account_type"),
    balanceKobo: bigint("balance_kobo", { mode: "bigint" }),
    balanceRetrievedAt: timestamp("balance_retrieved_at", { withTimezone: true }),
    status: bankAccountStatusEnum("status").notNull().default("active"),
    statusChangedAt: timestamp("status_changed_at", { withTimezone: true }),
    linkedAt: timestamp("linked_at", { withTimezone: true }).notNull().defaultNow(),
    // Last time a sync *produced usable data*, and last time we merely tried —
    // the second lets a failing account be retried on a back-off instead of
    // being hammered every page view.
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    lastSyncAttemptAt: timestamp("last_sync_attempt_at", { withTimezone: true }),
    dataVersion: integer("data_version").notNull().default(MONO_DATA_VERSION),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("bank_accounts_user_idx").on(t.userId)],
);

export const monoSyncTriggerEnum = pgEnum("mono_sync_trigger", [
  "link", // the customer just linked the account
  "customer",
  "admin", // a staff member pressed Refresh
  "webhook", // Mono said the data changed
  "system", // a scheduled or backfill run
]);

export const monoSyncStatusEnum = pgEnum("mono_sync_status", [
  "success", // every endpoint we asked for answered
  "partial", // some answered, some didn't — data was stored for those that did
  "failed", // nothing usable came back; previous data was kept
  "skipped", // not attempted, e.g. the stored data was still fresh
]);

// One row per attempt to talk to Mono about an account — including the ones
// that failed. This is the audit trail behind "why is this data stale?", and
// the reason a failing account can back off instead of retrying blindly.
export const monoSyncLogs = pgTable(
  "mono_sync_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id),
    bankAccountId: uuid("bank_account_id").references(() => bankAccounts.id),
    monoAccountId: text("mono_account_id"),
    trigger: monoSyncTriggerEnum("trigger").notNull(),
    triggeredByStaffId: uuid("triggered_by_staff_id").references(() => staff.id),
    status: monoSyncStatusEnum("status").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    durationMs: integer("duration_ms"),
    // Per-endpoint outcome, e.g. { account_details: "ok", income: "unavailable",
    // transactions: "ok" }. Small and structured on purpose — never a payload.
    endpoints: jsonb("endpoints"),
    transactionsFetched: integer("transactions_fetched").notNull().default(0),
    transactionsInserted: integer("transactions_inserted").notNull().default(0),
    // A short, sanitised reason. Never a raw provider body (that can echo a
    // customer's data back at us).
    errorMessage: text("error_message"),
    dataVersion: integer("data_version").notNull().default(MONO_DATA_VERSION),
  },
  (t) => [index("mono_sync_logs_user_idx").on(t.userId, t.startedAt)],
);

// The provider's original response, sealed. Contains the account holder's name,
// balances and full transaction history, so it is AES-256-GCM encrypted
// (MONO_RAW_ENCRYPTION_KEY) and expires (90 days by default). With no key
// configured nothing is written here at all — the normalised tables carry
// everything the product needs; this exists for audit and debugging.
export const monoRawResponses = pgTable(
  "mono_raw_responses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id),
    bankAccountId: uuid("bank_account_id").references(() => bankAccounts.id),
    monoAccountId: text("mono_account_id"),
    syncLogId: uuid("sync_log_id").references(() => monoSyncLogs.id),
    endpoint: text("endpoint").notNull(), // 'account_details' | 'transactions' | 'income'
    // iv:authTag:ciphertext (base64) of the gzipped JSON.
    payloadEncrypted: text("payload_encrypted").notNull(),
    payloadBytes: integer("payload_bytes").notNull(), // size before gzip + encryption
    retrievedAt: timestamp("retrieved_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    dataVersion: integer("data_version").notNull().default(MONO_DATA_VERSION),
  },
  (t) => [
    index("mono_raw_responses_user_idx").on(t.userId, t.retrievedAt),
    index("mono_raw_responses_expiry_idx").on(t.expiresAt),
  ],
);

export const transactionDirectionEnum = pgEnum("transaction_direction", ["credit", "debit"]);

// Bank transactions, one row each, de-duplicated per account so re-syncing
// overlapping windows never double-counts. Rolling 12 months (older rows are
// purged after a sync). Money is kobo, per the schema's money rule.
export const bankTransactions = pgTable(
  "bank_transactions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id),
    bankAccountId: uuid("bank_account_id").notNull().references(() => bankAccounts.id),
    monoAccountId: text("mono_account_id").notNull(),
    // Mono's transaction id, or — if a response ever lacks one — a stable hash
    // of its fields (see transaction-dedupe.ts). Unique per account.
    externalId: text("external_id").notNull(),
    externalIdSynthetic: boolean("external_id_synthetic").notNull().default(false),
    direction: transactionDirectionEnum("direction").notNull(),
    amountKobo: bigint("amount_kobo", { mode: "bigint" }).notNull(),
    // Always the original description — analysis may categorise it, never edit it.
    narration: text("narration").notNull().default(""),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    balanceAfterKobo: bigint("balance_after_kobo", { mode: "bigint" }),
    // Mono's own channel label (transfer, atm, …). Not our classification.
    providerCategory: text("provider_category"),
    // *Our* analytical category (salary, food, betting…). Null until the
    // analysis runs; an inference about the transaction, not a fact about the
    // customer.
    category: text("category"),
    // The transaction exactly as Mono sent it, so the admin's "view raw data"
    // never has to reconstruct anything.
    raw: jsonb("raw"),
    retrievedAt: timestamp("retrieved_at", { withTimezone: true }).notNull(),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    dataVersion: integer("data_version").notNull().default(MONO_DATA_VERSION),
  },
  (t) => [
    uniqueIndex("bank_transactions_account_external_uidx").on(t.bankAccountId, t.externalId),
    index("bank_transactions_user_time_idx").on(t.userId, t.occurredAt),
    index("bank_transactions_account_time_idx").on(t.bankAccountId, t.occurredAt),
    check("bank_transactions_amount_non_negative", sql`${t.amountKobo} >= 0`),
  ],
);

// What Mono's income product said, verbatim-normalised — provider facts,
// separate from our own synthesis in financial_summaries. Append-only.
export const incomeProfiles = pgTable(
  "income_profiles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id),
    bankAccountId: uuid("bank_account_id").references(() => bankAccounts.id),
    monoAccountId: text("mono_account_id"),
    syncLogId: uuid("sync_log_id").references(() => monoSyncLogs.id),
    source: text("source").notNull().default("mono_income"),
    monthlyIncomeKobo: bigint("monthly_income_kobo", { mode: "bigint" }),
    averageIncomeKobo: bigint("average_income_kobo", { mode: "bigint" }),
    confidence: text("confidence"), // 'high' | 'medium' | 'low'
    lastIncomeDescription: text("last_income_description"),
    retrievedAt: timestamp("retrieved_at", { withTimezone: true }).notNull(),
    dataVersion: integer("data_version").notNull().default(MONO_DATA_VERSION),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("income_profiles_user_idx").on(t.userId, t.retrievedAt)],
);

// An immutable, versioned snapshot of everything we concluded about a
// customer's finances at one moment. Append-only — never updated — so a credit
// application can point at exactly the numbers a decision was made on, even
// after newer data arrives. `version` counts up per customer.
export const financialSummaries = pgTable(
  "financial_summaries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id),
    bankAccountId: uuid("bank_account_id").references(() => bankAccounts.id),
    syncLogId: uuid("sync_log_id").references(() => monoSyncLogs.id),
    version: integer("version").notNull(),
    // When the underlying bank data was retrieved — what freshness is judged on.
    retrievedAt: timestamp("retrieved_at", { withTimezone: true }).notNull(),
    computedAt: timestamp("computed_at", { withTimezone: true }).notNull().defaultNow(),
    dataVersion: integer("data_version").notNull().default(MONO_DATA_VERSION),
    // Version of the analysis rules (bank-analysis.ts) that produced the
    // conclusions, so an old snapshot is read against the rules it was made under.
    analysisVersion: integer("analysis_version").notNull(),
    source: text("source").notNull(), // 'income_api' | 'statement' | 'unavailable'
    monthsAnalysed: integer("months_analysed").notNull().default(0),
    transactionsAnalysed: integer("transactions_analysed").notNull().default(0),
    salaryDetected: boolean("salary_detected").notNull().default(false),
    estimatedMonthlyIncomeKobo: bigint("estimated_monthly_income_kobo", { mode: "bigint" }),
    incomeConfidence: text("income_confidence"),
    salaryRegularity: text("salary_regularity"),
    employerNameMatch: boolean("employer_name_match"),
    balanceKobo: bigint("balance_kobo", { mode: "bigint" }),
    currency: text("currency").notNull().default("NGN"),
    // The full analysis object — what applicant_profiles.bank_analysis mirrors.
    analysis: jsonb("analysis").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("financial_summaries_user_version_uidx").on(t.userId, t.version),
    index("financial_summaries_user_idx").on(t.userId, t.version),
  ],
);

export const identityKindEnum = pgEnum("identity_kind", ["bvn", "nin", "mashup"]);
export const identityVerdictEnum = pgEnum("identity_verdict", ["match", "partial", "mismatch"]);

// Every identity check ever run on a customer — append-only, so "the BVN check
// followed by a NIN check" no longer erases the first. Stores the *comparison*
// (did the record agree with what they declared), never the government record
// itself: no photo, no address, no full identifier.
export const identityVerifications = pgTable(
  "identity_verifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id),
    kind: identityKindEnum("kind").notNull(),
    // 'otp_consent' (NIBSS asked the holder) | 'no_consent' (NIN / Mashup)
    method: text("method").notNull(),
    verdict: identityVerdictEnum("verdict").notNull(),
    // False when a fake client produced it. Kept, so the UI can show it — but
    // never counted as verified.
    live: boolean("live").notNull(),
    nameMatch: text("name_match"), // 'exact' | 'partial' | 'mismatch'
    dateOfBirthMatch: boolean("date_of_birth_match"),
    genderMatch: boolean("gender_match"),
    phoneMatch: boolean("phone_match"),
    ninCorroborated: boolean("nin_corroborated"),
    recordName: text("record_name"),
    // Who ran it: null when the customer did (BVN consent), the staff member otherwise.
    initiatedByStaffId: uuid("initiated_by_staff_id").references(() => staff.id),
    checkedAt: timestamp("checked_at", { withTimezone: true }).notNull(),
    retrievedAt: timestamp("retrieved_at", { withTimezone: true }).notNull().defaultNow(),
    dataVersion: integer("data_version").notNull().default(MONO_DATA_VERSION),
    // The full comparison object, as identity-match.ts produced it.
    result: jsonb("result").notNull(),
  },
  (t) => [index("identity_verifications_user_kind_idx").on(t.userId, t.kind, t.checkedAt)],
);
