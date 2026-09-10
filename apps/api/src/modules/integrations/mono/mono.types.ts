// Mono Connect — open banking for income / statement verification during KYC
// (WEB_APP_PLAN §9.1). Behind an interface with a fake, like every other
// integration. Base URL https://api.withmono.com, auth via the `mono-sec-key`
// header (the secret key), never exposed to a client.

export const MONO_CLIENT = Symbol("MONO_CLIENT");

export interface MonoAccountDetails {
  accountId: string;
  name: string | null;
  accountNumberLast4: string | null;
  bvn: string | null;
  balanceKobo: number | null;
  currency: string;
  institution: string | null;
}

export interface MonoTransaction {
  amountKobo: number;
  /** "credit" (money in) | "debit" (money out) */
  type: "credit" | "debit";
  narration: string;
  date: string; // ISO
  balanceKobo: number | null;
}

/** Mono's own income insight, when the product is enabled on the app. */
export interface MonoIncome {
  monthlyIncomeKobo: number | null;
  averageIncomeKobo: number | null;
  confidence: "high" | "medium" | "low" | null;
  lastIncomeDescription: string | null;
}

export interface MonoClient {
  /** True for the real client — the fake reports false so callers can note it. */
  readonly live: boolean;

  /** Swap a Connect widget `code` for a permanent account id (POST /v2/accounts/auth). */
  exchangeToken(code: string): Promise<{ accountId: string }>;

  getAccountDetails(accountId: string): Promise<MonoAccountDetails>;

  /** Up to `months` of history, newest first. Empty array if none. */
  getTransactions(accountId: string, months: number): Promise<MonoTransaction[]>;

  /** Mono income insights — null when the product isn't enabled or has no data. */
  getIncome(accountId: string): Promise<MonoIncome | null>;
}
