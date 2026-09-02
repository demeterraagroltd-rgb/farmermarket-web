import {
  bigint,
  char,
  date,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { users, staff } from "./identity.js";

// The verification lifecycle of a *person* (not a credit request — that's
// `applications`). Iterative: a reviewer can bounce a submission back with a
// note, the applicant fixes it, and it returns to `submitted`.
export const verificationStatusEnum = pgEnum("verification_status", [
  "unverified", // account exists, KYC not yet submitted / incomplete
  "submitted", // waiting on a reviewer
  "needs_more_info", // reviewer sent it back — see `verificationNote`
  "verified", // cleared; the person can check out
]);

// One row per customer. Filled at registration, read to pre-fill any future
// credit application. BVN/NIN are stored hashed + last-4 (never plaintext,
// §13); a reviewer unmasking the full value writes an `audit_logs` row.
export const applicantProfiles = pgTable("applicant_profiles", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id),

  // Identity
  fullName: text("full_name").notNull(),
  dateOfBirth: date("date_of_birth"),
  gender: text("gender"), // 'male' | 'female' | 'other'
  maritalStatus: text("marital_status"),
  dependantsCount: smallint("dependants_count"),
  bvnHash: text("bvn_hash"),
  bvnLast4: char("bvn_last4", { length: 4 }),
  nin: text("nin"), // deferrable — plaintext acceptable pre-KMS, revisit (§13)

  // Contact / where they live and are from
  phone: text("phone").notNull(),
  email: text("email"),
  residentialAddress: jsonb("residential_address"), // { street, city, state, lga }
  stateOfOrigin: text("state_of_origin"),
  lgaOfOrigin: text("lga_of_origin"),

  // Family
  nextOfKin: jsonb("next_of_kin"), // { name, relationship, phone }

  // Employment
  employmentType: text("employment_type"), // 'Government' | 'Private' | 'Self-employed'
  employer: text("employer"),
  jobTitle: text("job_title"),
  netMonthlySalaryKobo: bigint("net_monthly_salary_kobo", { mode: "bigint" }),
  salaryDay: smallint("salary_day"),
  yearsEmployed: text("years_employed"),

  // Banking (Mono fills `monoAccountId` later — Phase 5)
  bankName: text("bank_name"),
  accountLast4: char("account_last4", { length: 4 }),
  monoAccountId: text("mono_account_id"),

  verificationStatus: verificationStatusEnum("verification_status").notNull().default("unverified"),
  verificationNote: text("verification_note"), // reviewer -> applicant: what to fix
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  verifiedByStaffId: uuid("verified_by_staff_id").references(() => staff.id),
  submittedAt: timestamp("submitted_at", { withTimezone: true }),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const kycDocumentKindEnum = pgEnum("kyc_document_kind", [
  "id_card",
  "passport",
  "drivers_license",
  "nin_slip",
  "employment_letter",
  "payslip",
  "utility_bill",
  "bank_statement",
  "other",
]);

export const kycDocumentStatusEnum = pgEnum("kyc_document_status", [
  "pending",
  "accepted",
  "rejected",
  "superseded", // replaced by a newer upload of the same kind
]);

export const kycDocuments = pgTable("kyc_documents", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id),
  kind: kycDocumentKindEnum("kind").notNull(),
  cloudinaryPublicId: text("cloudinary_public_id").notNull(),
  cloudinaryResourceType: text("cloudinary_resource_type").notNull().default("image"),
  mimeType: text("mime_type"),
  sizeBytes: integer("size_bytes"),
  status: kycDocumentStatusEnum("status").notNull().default("pending"),
  rejectionReason: text("rejection_reason"),
  uploadedAt: timestamp("uploaded_at", { withTimezone: true }).notNull().defaultNow(),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  reviewedByStaffId: uuid("reviewed_by_staff_id").references(() => staff.id),
});

// Append-only trail of every verification transition — mirrors
// `application_events`, drives the "sent back N times" history.
export const kycEvents = pgTable("kyc_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id),
  actorStaffId: uuid("actor_staff_id").references(() => staff.id),
  fromStatus: verificationStatusEnum("from_status"),
  toStatus: verificationStatusEnum("to_status").notNull(),
  note: text("note"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
