import { Logger } from "@nestjs/common";
import type {
  MonoAccountDetails,
  MonoClient,
  MonoIncome,
  MonoTransaction,
} from "./mono.types";

/**
 * Used when `MONO_SECRET_KEY` isn't set. Any code exchanges to a stable fake
 * account id and returns a plausible 6-month salary history (₦250k on the
 * 28th, plus noise), so the whole link-bank → analyse → review chain works
 * locally without touching Mono. Same "no key ⇒ fake" pattern as SMS/email.
 */
export class FakeMonoClient implements MonoClient {
  readonly live = false;
  private readonly log = new Logger("FakeMonoClient");

  async exchangeToken(code: string): Promise<{ accountId: string }> {
    this.log.log(`[mono:fake] exchangeToken(${code.slice(0, 8)}…) → acct_fake`);
    return { accountId: "acct_fake" };
  }

  async getAccountDetails(): Promise<MonoAccountDetails> {
    return {
      accountId: "acct_fake",
      name: "ADA OKONKWO",
      accountNumberLast4: "4321",
      bvn: "22222222222",
      balanceKobo: 4_512_300,
      currency: "NGN",
      institution: "GTBank",
    };
  }

  async getTransactions(_accountId: string, months: number): Promise<MonoTransaction[]> {
    const out: MonoTransaction[] = [];
    const now = new Date();
    for (let m = 0; m < Math.min(months, 6); m++) {
      const d = new Date(now.getFullYear(), now.getMonth() - m, 28);
      out.push({
        amountKobo: 25_000_000, // ₦250,000 salary
        type: "credit",
        narration: "SALARY - ACME CORP LTD",
        date: d.toISOString(),
        balanceKobo: null,
      });
      out.push({
        amountKobo: 1_500_000 + m * 100_000,
        type: "debit",
        narration: "POS PURCHASE",
        date: new Date(d.getTime() + 2 * 86_400_000).toISOString(),
        balanceKobo: null,
      });
    }
    return out;
  }

  async getIncome(): Promise<MonoIncome | null> {
    return {
      monthlyIncomeKobo: 25_000_000,
      averageIncomeKobo: 25_000_000,
      confidence: "high",
      lastIncomeDescription: "SALARY - ACME CORP LTD",
    };
  }
}
