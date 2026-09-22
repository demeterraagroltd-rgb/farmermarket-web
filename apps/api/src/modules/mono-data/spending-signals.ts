import { CATEGORY_LABEL, type TransactionCategory } from "./transaction-categorization";

// Turns a window of already-categorised transactions into the things a credit
// officer actually wants to know: where the money goes, whether loan apps or
// betting show up and how often, and which transactions stand out from the
// account's own normal. Every figure here is descriptive of the data given —
// callers decide what "unusual" or "a lot of gambling" should mean for a
// decision.

export interface CategorizedTx {
  id: string;
  narration: string;
  direction: "credit" | "debit";
  amountKobo: number;
  occurredAt: Date;
  category: TransactionCategory;
}

export interface CategoryBreakdownRow {
  category: TransactionCategory;
  label: string;
  count: number;
  creditsKobo: number;
  debitsKobo: number;
  totalKobo: number;
}

/** Every category present, largest total first. */
export function categoryBreakdown(txs: CategorizedTx[]): CategoryBreakdownRow[] {
  const byCat = new Map<TransactionCategory, CategoryBreakdownRow>();
  for (const t of txs) {
    const row = byCat.get(t.category) ?? { category: t.category, label: CATEGORY_LABEL[t.category], count: 0, creditsKobo: 0, debitsKobo: 0, totalKobo: 0 };
    row.count += 1;
    row.totalKobo += t.amountKobo;
    if (t.direction === "credit") row.creditsKobo += t.amountKobo;
    else row.debitsKobo += t.amountKobo;
    byCat.set(t.category, row);
  }
  return [...byCat.values()].sort((a, b) => b.totalKobo - a.totalKobo);
}

const utcMonth = (d: Date) => d.toISOString().slice(0, 7);

export interface CategorySignal {
  category: TransactionCategory;
  present: boolean;
  count: number;
  totalKobo: number;
  monthsActive: number;
  monthsCovered: number;
  firstAt: string | null;
  lastAt: string | null;
  /** Second half of the window against the first half; null with too little history to compare. */
  trend: "increasing" | "decreasing" | "steady" | null;
  samples: string[];
}

/**
 * How much of one category shows up in the window, and whether it's growing.
 * `monthsCovered` is the window's own span (so "1 of 6 months had gambling
 * activity" reads correctly even when the category itself never appears).
 */
export function signalFor(txs: CategorizedTx[], category: TransactionCategory, monthsCovered: number): CategorySignal {
  const matches = txs.filter((t) => t.category === category).sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
  if (matches.length === 0) {
    return { category, present: false, count: 0, totalKobo: 0, monthsActive: 0, monthsCovered, firstAt: null, lastAt: null, trend: null, samples: [] };
  }

  const monthsActive = new Set(matches.map((t) => utcMonth(t.occurredAt))).size;
  const totalKobo = matches.reduce((s, t) => s + t.amountKobo, 0);
  const first = matches[0].occurredAt.getTime();
  const last = matches[matches.length - 1].occurredAt.getTime();

  let trend: CategorySignal["trend"] = null;
  if (monthsActive >= 2 && last > first) {
    const mid = first + (last - first) / 2;
    const early = matches.filter((t) => t.occurredAt.getTime() < mid).reduce((s, t) => s + t.amountKobo, 0);
    const late = matches.filter((t) => t.occurredAt.getTime() >= mid).reduce((s, t) => s + t.amountKobo, 0);
    trend = late > early * 1.2 ? "increasing" : late < early * 0.8 ? "decreasing" : "steady";
  }

  const byNarration = new Map<string, number>();
  for (const t of matches) byNarration.set(t.narration, (byNarration.get(t.narration) ?? 0) + 1);
  const samples = [...byNarration.entries()].sort((a, b) => b[1] - a[1]).map(([n]) => n).slice(0, 3);

  return {
    category,
    present: true,
    count: matches.length,
    totalKobo,
    monthsActive,
    monthsCovered,
    firstAt: matches[0].occurredAt.toISOString(),
    lastAt: matches[matches.length - 1].occurredAt.toISOString(),
    trend,
    samples,
  };
}

export interface UnusualTransaction {
  id: string;
  occurredAt: string;
  narration: string;
  direction: "credit" | "debit";
  amountKobo: number;
  category: TransactionCategory;
  /** How many times the account's typical (median) transaction of that direction this is. */
  multiple: number;
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
};

/**
 * Transactions well above what's typical *for this account* — not a fixed
 * naira threshold, since "large" means something different for every
 * customer. Skips a direction entirely until there's enough history to say
 * what "typical" even means, so a thin account isn't flagged wholesale.
 */
export function detectUnusualTransactions(
  txs: CategorizedTx[],
  opts: { minSample?: number; multiplier?: number; floorKobo?: number; top?: number } = {},
): UnusualTransaction[] {
  const minSample = opts.minSample ?? 5;
  const multiplier = opts.multiplier ?? 3;
  // Below this, "3x the median" is noise — a ₦50 median debit doesn't make a
  // ₦200 purchase notable.
  const floorKobo = opts.floorKobo ?? 5_000_00; // ₦5,000
  const top = opts.top ?? 10;

  const out: UnusualTransaction[] = [];
  for (const direction of ["credit", "debit"] as const) {
    const inDir = txs.filter((t) => t.direction === direction);
    if (inDir.length < minSample) continue;
    const med = median(inDir.map((t) => t.amountKobo));
    if (med <= 0) continue;
    const threshold = med * multiplier;
    for (const t of inDir) {
      if (t.amountKobo >= threshold && t.amountKobo >= floorKobo) {
        out.push({
          id: t.id,
          occurredAt: t.occurredAt.toISOString(),
          narration: t.narration,
          direction: t.direction,
          amountKobo: t.amountKobo,
          category: t.category,
          multiple: Math.round((t.amountKobo / med) * 10) / 10,
        });
      }
    }
  }
  return out.sort((a, b) => b.multiple - a.multiple).slice(0, top);
}
