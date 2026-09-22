// Sorts a transaction into a spending/income bucket from its narration, channel
// and direction. Like everything else under this file's name: an inference for
// a human to weigh, never a verdict — the original narration is never touched,
// and a transaction that matches nothing is "other", not miscategorised.
//
// Bumped whenever the rules below change; stored alongside a categorised
// transaction is out of scope (the transaction rows don't version this), so a
// rule change takes effect from the account's next sync, the same way a
// changed `providerCategory` mapping would.
export const CATEGORY_RULES_VERSION = 1;

export type TransactionCategory =
  | "salary"
  | "loan_disbursement"
  | "loan_repayment"
  | "gambling"
  | "savings_investment"
  | "airtime_data"
  | "bills_utilities"
  | "atm_withdrawal"
  | "pos_purchase"
  | "fees_charges"
  | "reversal_refund"
  | "transfer"
  | "other";

export interface CategorisableTx {
  narration: string;
  direction: "credit" | "debit";
  /** Mono's own channel label, when known — a hint, not the deciding signal. */
  channel?: string | null;
}

// Nigerian loan-app and lending-brand names, alongside generic loan wording.
// Sourced from what's common on Nigerian bank statements; a name missing here
// simply falls through to "transfer", not to a wrong category.
const LOAN_BRANDS =
  /\b(fairmoney|carbon|branch|palmcredit|palm\s?credit|aella|renmoney|ren\s?money|kwikcash|quickcheck|lidya|migo|sokoloan|okash|newcredit|easymoni|specta|creditville|credit\s?direct|umba|figment|fintech\s?loan)\b/i;
const LOAN_WORDS = /\b(loan|lpopay|repayment|disbursement|debt\s?service|overdue\s?instal?lment|instal?lment)\b/i;

const GAMBLING_BRANDS =
  /\b(bet9ja|sportybet|betking|nairabet|1xbet|melbet|betway|msport|parimatch|betwinner|betano|merrybet|betfair|betpawa|premierbet|betlion|winner\s?bet|surebet)\b/i;
const GAMBLING_WORDS = /\b(bet|casino|stake|wager|lottery|lotto|sport\s?bet|jackpot)\b/i;

const SAVINGS_BRANDS = /\b(piggyvest|piggy\s?vest|cowrywise|cowry\s?wise|ajo|esusu|thrift|kolomoni|kuda\s?save|stash|riby)\b/i;
const SAVINGS_WORDS = /\b(savings?\s?(plan|contribution|target)|cooperative|coop\s?contribution)\b/i;

const AIRTIME_WORDS =
  /\b(airtime|recharge|data\s?bundle|vtu|mtn|glo|airtel|9mobile|etisalat|spectranet|smile\s?4g)\b/i;

const BILLS_WORDS =
  /\b(dstv|gotv|startimes|phcn|nepa|ikedc|ekedc|eedc|aedc|kedco|jedc|phedc|electricity|water\s?corp|waste\s?management|internet\s?subscription|netflix|showmax|spotify)\b/i;

const FEES_WORDS =
  /\b(maintenance\s?fee|sms\s?alert|card\s?maint|stamp\s?duty|vat|commission|service\s?charge|account\s?maint|transfer\s?fee|handling\s?charge)\b(?!.*reversal)/i;
const CHARGE_WORD = /\bcharge\b/i;

const REVERSAL_WORDS = /\b(reversal|refund|chargeback|re[- ]?credit)\b/i;

const ATM_WORDS = /\batm\b|\bcash\s?withdrawal\b/i;
const POS_WORDS = /\bpos\b|point\s?of\s?sale/i;

/** Salary keywords are shared with the account-level analysis, so the two never disagree about wording. */
import { SALARY_KEYWORDS } from "../kyc/bank-analysis";

/**
 * First matching rule wins, most specific first: a reversed betting stake
 * should read as a reversal, and a loan app's "loan repayment fee" should read
 * as the loan repayment it is, not a generic fee.
 */
export function categorizeTransaction(tx: CategorisableTx): TransactionCategory {
  const n = tx.narration ?? "";
  const channel = (tx.channel ?? "").toLowerCase();

  if (REVERSAL_WORDS.test(n)) return "reversal_refund";
  if (LOAN_BRANDS.test(n) || LOAN_WORDS.test(n)) return tx.direction === "credit" ? "loan_disbursement" : "loan_repayment";
  if (GAMBLING_BRANDS.test(n) || GAMBLING_WORDS.test(n)) return "gambling";
  if (tx.direction === "credit" && SALARY_KEYWORDS.test(n)) return "salary";
  if (SAVINGS_BRANDS.test(n) || SAVINGS_WORDS.test(n)) return "savings_investment";
  if (BILLS_WORDS.test(n)) return "bills_utilities";
  if (AIRTIME_WORDS.test(n)) return "airtime_data";
  if (FEES_WORDS.test(n) || (CHARGE_WORD.test(n) && tx.direction === "debit")) return "fees_charges";
  if (ATM_WORDS.test(n) || channel === "atm") return "atm_withdrawal";
  if (POS_WORDS.test(n) || channel === "pos") return "pos_purchase";
  return "transfer";
}

export const CATEGORY_LABEL: Record<TransactionCategory, string> = {
  salary: "Salary",
  loan_disbursement: "Loan received",
  loan_repayment: "Loan repayment",
  gambling: "Gambling",
  savings_investment: "Savings / investment",
  airtime_data: "Airtime & data",
  bills_utilities: "Bills & utilities",
  atm_withdrawal: "ATM withdrawal",
  pos_purchase: "POS purchase",
  fees_charges: "Fees & charges",
  reversal_refund: "Reversal / refund",
  transfer: "Transfer",
  other: "Other",
};
