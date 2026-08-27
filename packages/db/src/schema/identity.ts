import { boolean, char, jsonb, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

// Customers — phone-OTP identity, distinct from staff (§6.1).
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  phone: text("phone").notNull().unique(),
  fullName: text("full_name"),
  email: text("email"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const staffRoleEnum = pgEnum("staff_role", ["super_admin", "admin", "credit", "sales"]);

// Dashboard staff — email/password + mandatory TOTP (§6.1).
export const staff = pgTable("staff", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  fullName: text("full_name").notNull(),
  role: staffRoleEnum("role").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// One row per TOTP secret. Kept separate from `staff` so enrolment/reset
// doesn't touch the account row (§6.1).
export const mfaCredentials = pgTable("mfa_credentials", {
  id: uuid("id").primaryKey().defaultRandom(),
  staffId: uuid("staff_id").notNull().references(() => staff.id),
  secret: text("secret").notNull(),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Server-side session row backing the rotating refresh token, so
// deactivating an account revokes access immediately (§6.1).
export const sessions = pgTable("sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  staffId: uuid("staff_id").references(() => staff.id),
  userId: uuid("user_id").references(() => users.id),
  refreshTokenHash: text("refresh_token_hash").notNull(),
  userAgent: text("user_agent"),
  ipAddress: text("ip_address"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Versioned, immutable consent capture — text version, timestamp, IP, UA (§13).
export const consents = pgTable("consents", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id),
  consentType: text("consent_type").notNull(),
  textVersion: text("text_version").notNull(),
  ipAddress: text("ip_address").notNull(),
  userAgent: text("user_agent").notNull(),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
