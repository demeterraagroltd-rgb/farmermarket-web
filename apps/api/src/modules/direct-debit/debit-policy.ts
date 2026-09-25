// Whether to take money for one installment right now. Pure and DB-free: the
// caller assembles what's known, this decides — nothing here reads a clock
// outside `now`. Every "no" carries a reason, because "why didn't it debit?" is
// the first question anyone will ask.

/** Mono's minimum debit is ₦200; below that an installment is left for the customer to pay. */
export const MIN_DEBIT_KOBO = 200 * 100;

/** Response-code marker for a failed attempt that must not count toward {@link MAX_ATTEMPTS}. */
export const NOT_COUNTED_CODE = "RL";

/** After this many failed attempts for one installment we stop and leave it to collections. */
export const MAX_ATTEMPTS = 4;

const HOUR = 3_600_000;

/**
 * How long to leave a failed installment alone before trying again. Mono
 * blocks an account for the day after 5 insufficient-funds attempts, and asks
 * for 3–5 days after a "do not honour" (05/25) — so never more than one attempt
 * a day, and longer where the bank asked for longer.
 */
export function retryWaitHours(responseCode: string | null): number {
  if (responseCode === "05" || responseCode === "25") return 72;
  return 24; // insufficient funds ("51") and everything else
}

/** What the customer is told for a failed debit — plain, and never blaming. */
export function failureExplanation(responseCode: string | null, message: string | null): string {
  switch (responseCode) {
    case "51":
      return "there wasn't enough money in the account";
    case "05":
    case "25":
      return "the bank declined the debit";
    default:
      return message ? message.toLowerCase() : "the bank couldn't complete the debit";
  }
}

export type SkipReason =
  | "not_due"
  | "below_minimum"
  | "no_active_mandate"
  | "mandate_cap_reached"
  | "in_flight"
  | "retry_wait"
  | "attempts_exhausted"
  | "needs_review"
  | "fcda_payroll";

export interface DebitDecision {
  debit: boolean;
  reason: SkipReason | "due";
  /** What to take, in kobo. Only meaningful when `debit` is true. */
  amountKobo: bigint;
  /** When a `retry_wait` decision will next allow an attempt. */
  retryAt?: Date;
}

export interface AttemptHistory {
  status: "initiated" | "processing" | "successful" | "failed" | "needs_review";
  responseCode: string | null;
  createdAt: Date;
}

export interface DebitDecisionInput {
  now: Date;
  dueDate: Date;
  /** What's still owed on the installment (amount − already paid). */
  remainingKobo: bigint;
  mandate: { status: string; amountKobo: bigint; collectedKobo: bigint } | null;
  /** Every attempt ever made for this installment, any order. */
  attempts: AttemptHistory[];
  employer: string | null;
}

/** FCDA staff repay through payroll deduction, not a bank debit — never double-collect from them. */
export function isFcdaEmployer(employer: string | null | undefined): boolean {
  const e = (employer ?? "").trim().toLowerCase();
  return e === "fcda" || e.includes("federal capital development authority");
}

export function decideDebit(input: DebitDecisionInput): DebitDecision {
  const none = (reason: SkipReason, extra: Partial<DebitDecision> = {}): DebitDecision => ({
    debit: false,
    reason,
    amountKobo: 0n,
    ...extra,
  });

  if (isFcdaEmployer(input.employer)) return none("fcda_payroll");
  if (input.dueDate.getTime() > input.now.getTime()) return none("not_due");
  if (!input.mandate || input.mandate.status !== "active") return none("no_active_mandate");
  if (input.remainingKobo < BigInt(MIN_DEBIT_KOBO)) return none("below_minimum");

  // A person must look at any attempt whose money may have moved unrecorded —
  // never stack another debit on top of it.
  if (input.attempts.some((a) => a.status === "needs_review")) return none("needs_review");
  if (input.attempts.some((a) => a.status === "initiated" || a.status === "processing")) return none("in_flight");

  const failed = input.attempts.filter((a) => a.status === "failed").sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  // "RL" marks a failure that says nothing about the customer's account — Mono
  // rate-limiting us, a request that never left, or one a person resolved. It
  // still waits out the day, but it doesn't use up one of the customer's attempts.
  if (failed.filter((a) => a.responseCode !== NOT_COUNTED_CODE).length >= MAX_ATTEMPTS) return none("attempts_exhausted");
  if (failed.length > 0) {
    const retryAt = new Date(failed[0].createdAt.getTime() + retryWaitHours(failed[0].responseCode) * HOUR);
    if (retryAt.getTime() > input.now.getTime()) return none("retry_wait", { retryAt });
  }

  // Never take more than the customer authorised.
  const room = input.mandate.amountKobo - input.mandate.collectedKobo;
  if (room < input.remainingKobo) return none("mandate_cap_reached");

  return { debit: true, reason: "due", amountKobo: input.remainingKobo };
}

/** How much a new mandate lets us collect: the credit limit plus 25% headroom for interest, never less than what's already owed. */
export function mandateCapKobo(creditLimitKobo: bigint, outstandingKobo: bigint): bigint {
  const withHeadroom = (creditLimitKobo * 125n) / 100n;
  return withHeadroom > outstandingKobo ? withHeadroom : outstandingKobo;
}
