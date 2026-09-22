import { SALARY_FLOOR_KOBO, SALARY_KEYWORDS } from "../kyc/bank-analysis";

// Who pays this customer, worked out from their stored credits.
//
// This is an analytical grouping, not a fact about the customer: narrations are
// free text typed by banks and senders, so "the same payer" is a heuristic —
// same leading words once references, dates and amounts are stripped. Every
// label here ("recurring", "likely salary") is an inference for a human to
// weigh, never a verdict, and the original narrations are always kept beside it.

export interface CreditTx {
  narration: string;
  amountKobo: number;
  occurredAt: Date;
}

export interface IncomeSource {
  /** Grouping key derived from the narration. */
  key: string;
  /** A readable payer label — the most common original narration in the group. */
  label: string;
  count: number;
  /** Distinct calendar months (UTC) the source paid in. */
  months: number;
  totalKobo: number;
  averageKobo: number;
  lastAt: string;
  /** Median day of month payments landed on; null for a one-off. */
  typicalDay: number | null;
  /** Share of all credits in the window, 0–1. */
  shareOfCredits: number;
  /** Paid in enough separate months to look like a pattern, not a coincidence. */
  recurring: boolean;
  /** Recurring, regular in size, and salary-shaped. An inference — see above. */
  likelySalary: boolean;
  /** Up to three original narrations, verbatim, so the grouping can be checked by eye. */
  samples: string[];
}

export interface IncomeSourcesResult {
  sources: IncomeSource[];
  totalCreditsKobo: number;
  /** Credits from sources beyond the ones returned. */
  otherKobo: number;
  monthsCovered: number;
}

const MONTH_WORDS = new Set([
  "JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "SEPT", "OCT", "NOV", "DEC",
  "JANUARY", "FEBRUARY", "MARCH", "APRIL", "JUNE", "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER",
]);
// Words that describe the *rail*, not the payer — "NIP TRANSFER FROM x" and
// "TRF FROM x" are the same payer.
const RAIL_WORDS = new Set(["NIP", "NEFT", "TRF", "TRANSFER", "FROM", "TO", "PAYMENT", "PMT", "FOR", "THE", "OF", "AND", "INWARD", "CREDIT", "CR", "MOBILE", "USSD", "WEB", "POS"]);

/** "NIP/GTB/ADA OKONKWO/SALARY SEPT 2026 ref 883412" → "GTB ADA OKONKWO SALARY". */
export function payerKey(narration: string): string {
  const tokens = narration
    .toUpperCase()
    .replace(/[^A-Z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter((w) => w && !/\d/.test(w) && !MONTH_WORDS.has(w) && !RAIL_WORDS.has(w) && w.length > 1);
  return tokens.slice(0, 4).join(" ");
}

const utcMonth = (d: Date) => d.toISOString().slice(0, 7);
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
};

/** Months a source must appear in to count as recurring. */
export const RECURRING_MIN_MONTHS = 3;
/** How far payments may vary from their median and still look like a salary. */
const SALARY_SPREAD = 0.25;

export function analyseIncomeSources(credits: CreditTx[], opts: { top?: number } = {}): IncomeSourcesResult {
  const top = opts.top ?? 8;
  const usable = credits.filter((c) => c.amountKobo > 0 && Number.isFinite(c.occurredAt.getTime()));
  const totalCreditsKobo = usable.reduce((s, c) => s + c.amountKobo, 0);
  const monthsCovered = new Set(usable.map((c) => utcMonth(c.occurredAt))).size;

  const groups = new Map<string, CreditTx[]>();
  for (const c of usable) {
    const key = payerKey(c.narration) || "(no description)";
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(c);
  }

  // With under a quarter of data, "3 months" can't be met — ask for what the
  // data can show, but never fewer than two.
  const need = Math.max(2, Math.min(RECURRING_MIN_MONTHS, monthsCovered));

  const all: IncomeSource[] = [...groups.entries()].map(([key, txs]) => {
    const months = new Set(txs.map((t) => utcMonth(t.occurredAt))).size;
    const totalKobo = txs.reduce((s, t) => s + t.amountKobo, 0);
    const amounts = txs.map((t) => t.amountKobo);
    const med = median(amounts);
    const recurring = months >= need;
    const regular = amounts.every((a) => Math.abs(a - med) <= med * SALARY_SPREAD);
    const salaryShaped = txs.some((t) => SALARY_KEYWORDS.test(t.narration)) || med >= SALARY_FLOOR_KOBO;

    const byNarration = new Map<string, number>();
    for (const t of txs) byNarration.set(t.narration, (byNarration.get(t.narration) ?? 0) + 1);
    const samples = [...byNarration.entries()].sort((a, b) => b[1] - a[1]).map(([n]) => n).slice(0, 3);
    const last = txs.reduce((a, b) => (b.occurredAt > a.occurredAt ? b : a));

    return {
      key,
      label: samples[0] ?? key,
      count: txs.length,
      months,
      totalKobo,
      averageKobo: Math.round(totalKobo / txs.length),
      lastAt: last.occurredAt.toISOString(),
      typicalDay: recurring ? median(txs.map((t) => t.occurredAt.getUTCDate())) : null,
      shareOfCredits: totalCreditsKobo ? totalKobo / totalCreditsKobo : 0,
      recurring,
      likelySalary: recurring && regular && salaryShaped,
      samples,
    };
  });

  all.sort((a, b) => b.totalKobo - a.totalKobo);
  const shown = all.slice(0, top);
  return {
    sources: shown,
    totalCreditsKobo,
    otherKobo: all.slice(top).reduce((s, x) => s + x.totalKobo, 0),
    monthsCovered,
  };
}
