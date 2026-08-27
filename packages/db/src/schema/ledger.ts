import { bigint, bigserial, char, check, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const ledgerAccounts = pgTable("ledger_accounts", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  type: text("type").notNull(), // 'asset' | 'liability' | 'revenue' | 'expense'
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Double-entry ledger. Every `transactionId` group must balance — debits
// equal credits — enforced by a deferred constraint trigger applied in a
// custom migration (Drizzle's declarative schema can't express it) (§5.4).
export const ledgerEntries = pgTable(
  "ledger_entries",
  {
    id: bigserial("id", { mode: "bigint" }).primaryKey(),
    transactionId: uuid("transaction_id").notNull(), // groups the legs
    accountId: uuid("account_id").notNull().references(() => ledgerAccounts.id),
    direction: char("direction", { length: 1 }).notNull(), // 'D' | 'C'
    amountKobo: bigint("amount_kobo", { mode: "bigint" }).notNull(),
    orderId: uuid("order_id"),
    repaymentId: uuid("repayment_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("direction_valid", sql`${table.direction} IN ('D','C')`),
    check("amount_positive", sql`${table.amountKobo} > 0`),
  ],
);
