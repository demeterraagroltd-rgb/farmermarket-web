// A readable statement built from the transactions we've stored: one row per
// calendar month with what came in, what went out, and — when the bank gave us
// running balances — where the account started and ended.
//
// This is *our* reconstruction, not a bank-issued statement: it is only as
// complete as the transactions Mono returned and we kept (a rolling year), and
// months are cut at UTC midnight so the same data always yields the same
// periods regardless of where the server runs.

export interface StatementRow {
  occurredAt: Date;
  direction: "credit" | "debit";
  amountKobo: number;
  balanceAfterKobo: number | null;
}

export interface StatementPeriod {
  /** "2026-09" */
  month: string;
  /** Inclusive start / exclusive end, ISO, for fetching the period's transactions. */
  from: string;
  to: string;
  count: number;
  creditsKobo: number;
  debitsKobo: number;
  netKobo: number;
  /** Null unless the bank supplied running balances for this period. */
  openingKobo: number | null;
  closingKobo: number | null;
}

export interface Statement {
  periods: StatementPeriod[];
  totals: { count: number; creditsKobo: number; debitsKobo: number; netKobo: number };
}

const monthStart = (y: number, m: number) => new Date(Date.UTC(y, m, 1));
const key = (d: Date) => d.toISOString().slice(0, 7);

/**
 * `from`/`to` bound the statement; every month between them appears, including
 * quiet ones — a gap in activity is information, and silently skipping a month
 * would read as a gap in the data.
 */
export function buildStatement(rows: StatementRow[], range: { from: Date; to: Date }): Statement {
  const inRange = rows.filter((r) => r.occurredAt >= range.from && r.occurredAt <= range.to);
  const byMonth = new Map<string, StatementRow[]>();
  for (const r of inRange) {
    const k = key(r.occurredAt);
    (byMonth.get(k) ?? byMonth.set(k, []).get(k)!).push(r);
  }

  const periods: StatementPeriod[] = [];
  let cursor = monthStart(range.from.getUTCFullYear(), range.from.getUTCMonth());
  const end = monthStart(range.to.getUTCFullYear(), range.to.getUTCMonth());
  while (cursor <= end) {
    const next = monthStart(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1);
    const month = key(cursor);
    const monthRows = (byMonth.get(month) ?? []).sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
    const creditsKobo = monthRows.filter((r) => r.direction === "credit").reduce((s, r) => s + r.amountKobo, 0);
    const debitsKobo = monthRows.filter((r) => r.direction === "debit").reduce((s, r) => s + r.amountKobo, 0);

    // Opening = the balance *before* the first transaction, i.e. its running
    // balance with that transaction's own effect taken back out.
    const first = monthRows[0];
    const last = monthRows[monthRows.length - 1];
    const openingKobo =
      first && first.balanceAfterKobo != null
        ? first.balanceAfterKobo - (first.direction === "credit" ? first.amountKobo : -first.amountKobo)
        : null;
    const closingKobo = last && last.balanceAfterKobo != null ? last.balanceAfterKobo : null;

    periods.push({
      month,
      from: cursor.toISOString(),
      to: next.toISOString(),
      count: monthRows.length,
      creditsKobo,
      debitsKobo,
      netKobo: creditsKobo - debitsKobo,
      openingKobo,
      closingKobo,
    });
    cursor = next;
  }

  const creditsKobo = periods.reduce((s, p) => s + p.creditsKobo, 0);
  const debitsKobo = periods.reduce((s, p) => s + p.debitsKobo, 0);
  return {
    periods,
    totals: { count: inRange.length, creditsKobo, debitsKobo, netKobo: creditsKobo - debitsKobo },
  };
}
