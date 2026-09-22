import { describe, expect, it } from "vitest";
import { categorizeTransaction } from "./transaction-categorization";
import { categoryBreakdown, detectUnusualTransactions, signalFor, type CategorizedTx } from "./spending-signals";
import { analyseRecurringExpenses, type DebitTx } from "./recurring-expenses";
import { employerNameLooksReal, employerPaymentMatch } from "./employer-signals";
import { analyseIncomeSources } from "./income-sources";

const d = (iso: string) => new Date(iso);
const tx = (over: Partial<CategorizedTx> & Pick<CategorizedTx, "narration" | "direction" | "amountKobo">): CategorizedTx => ({
  id: over.id ?? Math.random().toString(36).slice(2),
  occurredAt: over.occurredAt ?? d("2026-07-15T09:00:00Z"),
  category: over.category ?? categorizeTransaction(over),
  ...over,
});

describe("categorizeTransaction", () => {
  it("recognises loan apps by brand, direction deciding disbursement vs repayment", () => {
    expect(categorizeTransaction({ narration: "FAIRMONEY LOAN DISBURSEMENT", direction: "credit" })).toBe("loan_disbursement");
    expect(categorizeTransaction({ narration: "REPAYMENT TO FAIRMONEY", direction: "debit" })).toBe("loan_repayment");
    expect(categorizeTransaction({ narration: "CARBON LOAN REPAYMENT", direction: "debit" })).toBe("loan_repayment");
  });

  it("recognises gambling brands and generic betting words", () => {
    expect(categorizeTransaction({ narration: "BET9JA DEPOSIT", direction: "debit" })).toBe("gambling");
    expect(categorizeTransaction({ narration: "SPORTYBET WINNINGS", direction: "credit" })).toBe("gambling");
    expect(categorizeTransaction({ narration: "CASINO NIGHT STAKE", direction: "debit" })).toBe("gambling");
  });

  it("only calls a credit salary, never a debit", () => {
    expect(categorizeTransaction({ narration: "ACME CORP SALARY", direction: "credit" })).toBe("salary");
    expect(categorizeTransaction({ narration: "ACME CORP SALARY ADVANCE REPAYMENT", direction: "debit" })).not.toBe("salary");
  });

  it("recognises savings apps, bills and airtime", () => {
    expect(categorizeTransaction({ narration: "PIGGYVEST SAVINGS", direction: "debit" })).toBe("savings_investment");
    expect(categorizeTransaction({ narration: "DSTV SUBSCRIPTION", direction: "debit" })).toBe("bills_utilities");
    expect(categorizeTransaction({ narration: "MTN AIRTIME RECHARGE", direction: "debit" })).toBe("airtime_data");
  });

  it("a reversal is a reversal even if it also mentions betting or a fee", () => {
    expect(categorizeTransaction({ narration: "REVERSAL: BET9JA DEPOSIT FAILED", direction: "credit" })).toBe("reversal_refund");
    expect(categorizeTransaction({ narration: "CHARGE REVERSAL", direction: "credit" })).toBe("reversal_refund");
  });

  it("recognises ATM withdrawals and POS purchases, by wording or channel", () => {
    expect(categorizeTransaction({ narration: "ATM WITHDRAWAL LAGOS", direction: "debit" })).toBe("atm_withdrawal");
    expect(categorizeTransaction({ narration: "CASH WITHDRAWAL", direction: "debit", channel: "atm" })).toBe("atm_withdrawal");
    expect(categorizeTransaction({ narration: "SHOPRITE PURCHASE", direction: "debit", channel: "pos" })).toBe("pos_purchase");
  });

  it("falls back to transfer, then other only never applies automatically", () => {
    expect(categorizeTransaction({ narration: "NIP/GTB/BOLA ADEYEMI", direction: "credit" })).toBe("transfer");
  });

  it("a debit-only fee word is a fee; the same word on a credit doesn't force it", () => {
    expect(categorizeTransaction({ narration: "SMS ALERT CHARGE", direction: "debit" })).toBe("fees_charges");
  });
});

describe("categoryBreakdown", () => {
  it("totals per category and sorts largest first", () => {
    const rows = categoryBreakdown([
      tx({ narration: "ACME CORP SALARY", direction: "credit", amountKobo: 30_000_000 }),
      tx({ narration: "BET9JA DEPOSIT", direction: "debit", amountKobo: 500_000 }),
      tx({ narration: "BET9JA DEPOSIT", direction: "debit", amountKobo: 300_000 }),
    ]);
    expect(rows[0]).toMatchObject({ category: "salary", count: 1, creditsKobo: 30_000_000, debitsKobo: 0, totalKobo: 30_000_000 });
    expect(rows[1]).toMatchObject({ category: "gambling", count: 2, debitsKobo: 800_000, totalKobo: 800_000 });
  });
});

describe("signalFor", () => {
  it("reports present: false with nothing to show when the category never appears", () => {
    const s = signalFor([tx({ narration: "ACME CORP SALARY", direction: "credit", amountKobo: 1 })], "gambling", 6);
    expect(s).toMatchObject({ present: false, count: 0, totalKobo: 0, monthsActive: 0, monthsCovered: 6, trend: null });
  });

  it("totals and counts months active for the category that does appear", () => {
    const s = signalFor(
      [
        tx({ narration: "BET9JA DEPOSIT", direction: "debit", amountKobo: 100_000, occurredAt: d("2026-06-01T00:00:00Z") }),
        tx({ narration: "BET9JA DEPOSIT", direction: "debit", amountKobo: 200_000, occurredAt: d("2026-07-01T00:00:00Z") }),
      ],
      "gambling",
      6,
    );
    expect(s).toMatchObject({ present: true, count: 2, totalKobo: 300_000, monthsActive: 2 });
  });

  it("calls it increasing when the second half of the window outspends the first", () => {
    const s = signalFor(
      [
        tx({ narration: "BET9JA DEPOSIT", direction: "debit", amountKobo: 50_000, occurredAt: d("2026-04-01T00:00:00Z") }),
        tx({ narration: "BET9JA DEPOSIT", direction: "debit", amountKobo: 500_000, occurredAt: d("2026-08-01T00:00:00Z") }),
      ],
      "gambling",
      6,
    );
    expect(s.trend).toBe("increasing");
  });

  it("calls it steady when spending doesn't meaningfully move", () => {
    const s = signalFor(
      [
        tx({ narration: "DSTV SUBSCRIPTION", direction: "debit", amountKobo: 100_000, occurredAt: d("2026-04-01T00:00:00Z") }),
        tx({ narration: "DSTV SUBSCRIPTION", direction: "debit", amountKobo: 105_000, occurredAt: d("2026-08-01T00:00:00Z") }),
      ],
      "bills_utilities",
      6,
    );
    expect(s.trend).toBe("steady");
  });

  it("leaves trend null with only one month of activity", () => {
    const s = signalFor([tx({ narration: "BET9JA DEPOSIT", direction: "debit", amountKobo: 100_000 })], "gambling", 6);
    expect(s.trend).toBeNull();
  });
});

describe("detectUnusualTransactions", () => {
  const typical = (n: number, amountKobo: number, direction: "credit" | "debit" = "debit") =>
    Array.from({ length: n }, (_, i) => tx({ narration: "POS SHOPRITE", direction, amountKobo, occurredAt: d(`2026-0${(i % 6) + 1}-10T00:00:00Z`) }));

  it("flags a transaction well above the account's own median", () => {
    const txs = [...typical(6, 5_000_00), tx({ narration: "POS EXPENSIVE ITEM", direction: "debit", amountKobo: 40_000_00 })];
    const out = detectUnusualTransactions(txs);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ narration: "POS EXPENSIVE ITEM", multiple: 8 });
  });

  it("does not flag anything when there isn't enough history to know what's typical", () => {
    const txs = [...typical(3, 5_000_00), tx({ narration: "BIG ONE", direction: "debit", amountKobo: 40_000_00 })];
    expect(detectUnusualTransactions(txs)).toEqual([]);
  });

  it("ignores a large multiple that's still small in absolute terms", () => {
    const txs = [...typical(6, 100), tx({ narration: "SLIGHTLY BIGGER", direction: "debit", amountKobo: 1000 })];
    expect(detectUnusualTransactions(txs)).toEqual([]);
  });

  it("treats credits and debits separately", () => {
    const txs = [...typical(6, 5_000_00, "debit"), ...typical(6, 30_000_00, "credit"), tx({ narration: "HUGE CREDIT", direction: "credit", amountKobo: 300_000_00 })];
    const out = detectUnusualTransactions(txs);
    expect(out.map((o) => o.narration)).toEqual(["HUGE CREDIT"]);
  });

  it("caps results at top and sorts by multiple descending", () => {
    const txs = [...typical(6, 1_000_00), tx({ narration: "A", direction: "debit", amountKobo: 4_000_00 }), tx({ narration: "B", direction: "debit", amountKobo: 9_000_00 })];
    const out = detectUnusualTransactions(txs, { top: 1 });
    expect(out).toHaveLength(1);
    expect(out[0].narration).toBe("B");
  });
});

describe("analyseRecurringExpenses", () => {
  const monthly = (narration: string, amountKobo: number, months: string[], category: DebitTx["category"] = "bills_utilities"): DebitTx[] =>
    months.map((m) => ({ narration, amountKobo, category, occurredAt: d(`${m}-05T09:00:00Z`) }));

  it("groups a recurring payee and reports its dominant category", () => {
    const r = analyseRecurringExpenses(monthly("DSTV SUBSCRIPTION", 620000, ["2026-05", "2026-06", "2026-07"]));
    expect(r.items[0]).toMatchObject({ key: "DSTV SUBSCRIPTION", category: "bills_utilities", recurring: true, months: 3 });
  });

  it("does not call a one-off payment recurring", () => {
    const r = analyseRecurringExpenses([{ narration: "RANDOM STORE", amountKobo: 500000, category: "pos_purchase", occurredAt: d("2026-07-01T00:00:00Z") }]);
    expect(r.items[0].recurring).toBe(false);
  });

  it("computes each group's share of total debits and rolls the rest into otherKobo", () => {
    const r = analyseRecurringExpenses(
      [
        ...monthly("DSTV SUBSCRIPTION", 600000, ["2026-06", "2026-07"]),
        { narration: "ONE OFF PURCHASE", amountKobo: 400000, category: "pos_purchase", occurredAt: d("2026-07-01T00:00:00Z") },
      ],
      { top: 1 },
    );
    expect(r.items).toHaveLength(1);
    expect(r.otherKobo).toBe(400000);
    expect(r.totalDebitsKobo).toBe(1_600_000);
  });
});

describe("employerNameLooksReal", () => {
  it("accepts an ordinary business name", () => {
    expect(employerNameLooksReal("Acme Foods Nigeria Ltd").suspicious).toBe(false);
  });

  it("flags blank, placeholder and joke entries", () => {
    expect(employerNameLooksReal("").suspicious).toBe(true);
    expect(employerNameLooksReal("   ").suspicious).toBe(true);
    expect(employerNameLooksReal("N/A").suspicious).toBe(true);
    expect(employerNameLooksReal("test").suspicious).toBe(true);
    expect(employerNameLooksReal("xxxx").suspicious).toBe(true);
    expect(employerNameLooksReal("asdf").suspicious).toBe(true);
  });

  it("flags names that are too short, all-digits, or have no letters at all", () => {
    expect(employerNameLooksReal("ab").suspicious).toBe(true);
    expect(employerNameLooksReal("12345").suspicious).toBe(true);
    expect(employerNameLooksReal("!!!").suspicious).toBe(true);
  });

  it("does not flag a short but real-looking acronym-style name alone as digits/no-letters", () => {
    // Three letters clears the length bar and contains a letter — no reason to flag it.
    expect(employerNameLooksReal("GTB").suspicious).toBe(false);
  });
});

describe("employerPaymentMatch", () => {
  it("matches when a stored income source's narration names the employer", () => {
    const income = analyseIncomeSources([
      { narration: "NIP/ACME FOODS LTD/SALARY", amountKobo: 30_000_000, occurredAt: d("2026-07-25T09:00:00Z") },
      { narration: "NIP/ACME FOODS LTD/SALARY", amountKobo: 30_000_000, occurredAt: d("2026-08-25T09:00:00Z") },
    ]);
    const m = employerPaymentMatch("Acme Foods Ltd", income);
    expect(m.matched).toBe(true);
    expect(m.source?.key).toContain("ACME");
  });

  it("does not match when nothing in the income sources names the employer", () => {
    const income = analyseIncomeSources([{ narration: "NIP/RANDOM PERSON/GIFT", amountKobo: 30_000_000, occurredAt: d("2026-07-25T09:00:00Z") }]);
    expect(employerPaymentMatch("Acme Foods Ltd", income).matched).toBe(false);
  });

  it("returns unmatched, not a crash, with no declared employer or no income", () => {
    const income = analyseIncomeSources([]);
    expect(employerPaymentMatch(null, income)).toEqual({ matched: false, source: null });
    expect(employerPaymentMatch("Acme Foods Ltd", income)).toEqual({ matched: false, source: null });
  });

  it("prefers a recurring, likely-salary match over an incidental one-off that shares a word", () => {
    const income = analyseIncomeSources([
      { narration: "NIP/ACME FOODS LTD/SALARY", amountKobo: 30_000_000, occurredAt: d("2026-06-25T09:00:00Z") },
      { narration: "NIP/ACME FOODS LTD/SALARY", amountKobo: 30_000_000, occurredAt: d("2026-07-25T09:00:00Z") },
      { narration: "ACME FOODS RAFFLE WINNINGS", amountKobo: 90_000_000, occurredAt: d("2026-07-02T09:00:00Z") },
    ]);
    const m = employerPaymentMatch("Acme Foods Ltd", income);
    expect(m.source?.likelySalary).toBe(true);
  });
});
