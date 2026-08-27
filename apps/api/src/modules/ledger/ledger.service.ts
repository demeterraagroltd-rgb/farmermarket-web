import { Injectable } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { ledgerAccounts, ledgerEntries, type Tx } from "@farmermarket/db";

export type LedgerLeg = {
  accountName: string;
  accountType: "asset" | "liability" | "revenue" | "expense";
  direction: "D" | "C";
  amountKobo: bigint;
  orderId?: string;
  repaymentId?: string;
};

/**
 * Every write goes through here so "does this balance" is enforced in one
 * place, not re-derived at each call site (§5.4). Callers always pass the
 * transaction-scoped `tx`, not the module-level `db` — these legs must
 * commit atomically with whatever business row (order, repayment) they're
 * backing, and the deferred balance-check trigger (packages/db/migrations/
 * 0001_manual_triggers.sql) only fires at that transaction's commit.
 *
 * Accounts are get-or-created by name rather than seeded up front — there
 * are only a handful (Loans Receivable, Sales Revenue, Cash), and this way
 * there's no separate seed step to forget, matching how bnpl_plans required
 * one and that's been a recurring friction point.
 */
@Injectable()
export class LedgerService {
  async post(tx: Tx, transactionId: string, legs: LedgerLeg[]): Promise<void> {
    const debits = legs.filter((l) => l.direction === "D").reduce((s, l) => s + l.amountKobo, 0n);
    const credits = legs.filter((l) => l.direction === "C").reduce((s, l) => s + l.amountKobo, 0n);
    if (debits !== credits) {
      // Fails fast with a clear message instead of letting the DB's
      // deferred trigger (if applied) throw an opaque constraint error at
      // commit time — or, if the trigger isn't applied yet, silently
      // posting an imbalanced ledger.
      throw new Error(`Ledger legs do not balance: ${debits} debit vs ${credits} credit kobo`);
    }

    const accountIds = new Map<string, string>();
    for (const leg of legs) {
      if (accountIds.has(leg.accountName)) continue;
      accountIds.set(leg.accountName, await this.getOrCreateAccount(tx, leg.accountName, leg.accountType));
    }

    await tx.insert(ledgerEntries).values(
      legs.map((leg) => ({
        transactionId,
        accountId: accountIds.get(leg.accountName)!,
        direction: leg.direction,
        amountKobo: leg.amountKobo,
        orderId: leg.orderId,
        repaymentId: leg.repaymentId,
      })),
    );
  }

  private async getOrCreateAccount(tx: Tx, name: string, type: string): Promise<string> {
    const [existing] = await tx.select().from(ledgerAccounts).where(eq(ledgerAccounts.name, name)).limit(1);
    if (existing) return existing.id;
    const [created] = await tx.insert(ledgerAccounts).values({ name, type }).returning();
    return created.id;
  }
}
