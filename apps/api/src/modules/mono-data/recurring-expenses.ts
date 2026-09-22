import { payerKey, RECURRING_MIN_MONTHS } from "./income-sources";
import type { TransactionCategory } from "./transaction-categorization";

// The debit side of income-sources.ts: who this customer keeps paying,
// grouped the same way (by the wording of the narration, with rails,
// references and dates stripped) so a subscription, a loan app or a savings
// contribution shows up as one line instead of one per month.

export interface DebitTx {
  narration: string;
  amountKobo: number;
  occurredAt: Date;
  category: TransactionCategory;
}

export interface RecurringExpense {
  key: string;
  label: string;
  /** The category most of this group's transactions fall under. */
  category: TransactionCategory;
  count: number;
  months: number;
  totalKobo: number;
  averageKobo: number;
  lastAt: string;
  typicalDay: number | null;
  shareOfDebits: number;
  recurring: boolean;
  samples: string[];
}

export interface RecurringExpensesResult {
  items: RecurringExpense[];
  totalDebitsKobo: number;
  /** Debits from payees beyond the ones returned. */
  otherKobo: number;
  monthsCovered: number;
}

const utcMonth = (d: Date) => d.toISOString().slice(0, 7);
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
};
const mode = <T,>(xs: T[]): T => {
  const counts = new Map<T, number>();
  for (const x of xs) counts.set(x, (counts.get(x) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
};

export function analyseRecurringExpenses(debits: DebitTx[], opts: { top?: number } = {}): RecurringExpensesResult {
  const top = opts.top ?? 10;
  const usable = debits.filter((d) => d.amountKobo > 0 && Number.isFinite(d.occurredAt.getTime()));
  const totalDebitsKobo = usable.reduce((s, d) => s + d.amountKobo, 0);
  const monthsCovered = new Set(usable.map((d) => utcMonth(d.occurredAt))).size;

  const groups = new Map<string, DebitTx[]>();
  for (const d of usable) {
    const key = payerKey(d.narration) || "(no description)";
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(d);
  }

  const need = Math.max(2, Math.min(RECURRING_MIN_MONTHS, monthsCovered));

  const all: RecurringExpense[] = [...groups.entries()].map(([key, txs]) => {
    const months = new Set(txs.map((t) => utcMonth(t.occurredAt))).size;
    const totalKobo = txs.reduce((s, t) => s + t.amountKobo, 0);
    const recurring = months >= need;

    const byNarration = new Map<string, number>();
    for (const t of txs) byNarration.set(t.narration, (byNarration.get(t.narration) ?? 0) + 1);
    const samples = [...byNarration.entries()].sort((a, b) => b[1] - a[1]).map(([n]) => n).slice(0, 3);
    const last = txs.reduce((a, b) => (b.occurredAt > a.occurredAt ? b : a));

    return {
      key,
      label: samples[0] ?? key,
      category: mode(txs.map((t) => t.category)),
      count: txs.length,
      months,
      totalKobo,
      averageKobo: Math.round(totalKobo / txs.length),
      lastAt: last.occurredAt.toISOString(),
      typicalDay: recurring ? median(txs.map((t) => t.occurredAt.getUTCDate())) : null,
      shareOfDebits: totalDebitsKobo ? totalKobo / totalDebitsKobo : 0,
      recurring,
      samples,
    };
  });

  all.sort((a, b) => b.totalKobo - a.totalKobo);
  const shown = all.slice(0, top);
  return {
    items: shown,
    totalDebitsKobo,
    otherKobo: all.slice(top).reduce((s, x) => s + x.totalKobo, 0),
    monthsCovered,
  };
}
