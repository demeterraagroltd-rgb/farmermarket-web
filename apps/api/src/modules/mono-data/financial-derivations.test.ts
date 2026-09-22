import { describe, expect, it } from "vitest";
import { analyseIncomeSources, payerKey, type CreditTx } from "./income-sources";
import { buildStatement, type StatementRow } from "./statement-periods";
import { csvCell, nairaFromKobo, toCsv } from "../customers/csv";

const d = (iso: string) => new Date(iso);

describe("payerKey", () => {
  it("ignores the rail, references, months and amounts so one payer is one key", () => {
    const a = payerKey("NIP/GTB/ADA OKONKWO/SALARY SEPT 2026 ref 883412");
    const b = payerKey("TRF FROM GTB ADA OKONKWO SALARY OCT 2026 ref 100234");
    expect(a).toBe(b);
    expect(a).toContain("SALARY");
  });

  it("keeps different payers apart", () => {
    expect(payerKey("ACME CORP SALARY")).not.toBe(payerKey("CHIOMA STORES REFUND"));
  });

  it("returns an empty key for a narration that is only noise", () => {
    expect(payerKey("NIP 123456")).toBe("");
  });
});

describe("analyseIncomeSources", () => {
  const monthly = (narration: string, amountKobo: number, months: string[], day = 25): CreditTx[] =>
    months.map((m) => ({ narration, amountKobo, occurredAt: d(`${m}-${day}T09:00:00Z`) }));

  it("flags a regular, salary-worded, recurring payer as a likely salary", () => {
    const credits = monthly("ACME CORP SALARY", 25_000_000, ["2026-05", "2026-06", "2026-07", "2026-08"]);
    const r = analyseIncomeSources(credits);
    expect(r.sources).toHaveLength(1);
    expect(r.sources[0]).toMatchObject({ recurring: true, likelySalary: true, months: 4, typicalDay: 25, count: 4 });
    expect(r.sources[0].shareOfCredits).toBe(1);
  });

  it("does not call a one-off large credit a salary", () => {
    const r = analyseIncomeSources([{ narration: "LAND SALE PROCEEDS", amountKobo: 90_000_000, occurredAt: d("2026-07-02T10:00:00Z") }]);
    expect(r.sources[0]).toMatchObject({ recurring: false, likelySalary: false, typicalDay: null });
  });

  it("does not call an irregular recurring payer a salary", () => {
    const credits: CreditTx[] = [
      { narration: "ACME CORP SALARY", amountKobo: 5_000_000, occurredAt: d("2026-05-25T09:00:00Z") },
      { narration: "ACME CORP SALARY", amountKobo: 40_000_000, occurredAt: d("2026-06-25T09:00:00Z") },
      { narration: "ACME CORP SALARY", amountKobo: 9_000_000, occurredAt: d("2026-07-25T09:00:00Z") },
    ];
    const r = analyseIncomeSources(credits);
    expect(r.sources[0].recurring).toBe(true);
    expect(r.sources[0].likelySalary).toBe(false);
  });

  it("orders by amount, reports shares, and rolls the rest into otherKobo", () => {
    const credits = [
      ...monthly("ACME CORP SALARY", 30_000_000, ["2026-06", "2026-07", "2026-08"]),
      { narration: "ADA TRANSFER", amountKobo: 1_000_000, occurredAt: d("2026-07-03T10:00:00Z") },
      { narration: "BOLA TRANSFER", amountKobo: 2_000_000, occurredAt: d("2026-07-04T10:00:00Z") },
    ];
    const r = analyseIncomeSources(credits, { top: 2 });
    expect(r.sources.map((s) => s.key)).toEqual(["ACME CORP SALARY", "BOLA"]);
    expect(r.otherKobo).toBe(1_000_000);
    expect(r.totalCreditsKobo).toBe(93_000_000);
  });

  it("keeps the original narrations as samples", () => {
    const r = analyseIncomeSources([
      { narration: "NIP/ACME CORP/SALARY SEPT 2026", amountKobo: 1, occurredAt: d("2026-09-25T09:00:00Z") },
    ]);
    expect(r.sources[0].samples).toEqual(["NIP/ACME CORP/SALARY SEPT 2026"]);
  });

  it("ignores zero and negative amounts and handles no credits", () => {
    expect(analyseIncomeSources([]).sources).toEqual([]);
    expect(analyseIncomeSources([{ narration: "X", amountKobo: 0, occurredAt: d("2026-01-01T00:00:00Z") }]).sources).toEqual([]);
  });

  it("lowers the recurring bar when there is little history, but never below two months", () => {
    const two = analyseIncomeSources(monthly("ACME CORP SALARY", 25_000_000, ["2026-07", "2026-08"]));
    expect(two.sources[0].recurring).toBe(true);
    const one = analyseIncomeSources(monthly("ACME CORP SALARY", 25_000_000, ["2026-08"]));
    expect(one.sources[0].recurring).toBe(false);
  });
});

describe("buildStatement", () => {
  const rows: StatementRow[] = [
    { occurredAt: d("2026-07-02T10:00:00Z"), direction: "credit", amountKobo: 100_00, balanceAfterKobo: 300_00 },
    { occurredAt: d("2026-07-20T10:00:00Z"), direction: "debit", amountKobo: 40_00, balanceAfterKobo: 260_00 },
    { occurredAt: d("2026-09-05T10:00:00Z"), direction: "debit", amountKobo: 10_00, balanceAfterKobo: 250_00 },
  ];
  const range = { from: d("2026-07-01T00:00:00Z"), to: d("2026-09-30T23:59:59Z") };

  it("includes every month in range, even a quiet one", () => {
    const s = buildStatement(rows, range);
    expect(s.periods.map((p) => p.month)).toEqual(["2026-07", "2026-08", "2026-09"]);
    expect(s.periods[1]).toMatchObject({ count: 0, creditsKobo: 0, debitsKobo: 0, openingKobo: null, closingKobo: null });
  });

  it("totals credits and debits per month and overall", () => {
    const s = buildStatement(rows, range);
    expect(s.periods[0]).toMatchObject({ count: 2, creditsKobo: 100_00, debitsKobo: 40_00, netKobo: 60_00 });
    expect(s.totals).toEqual({ count: 3, creditsKobo: 100_00, debitsKobo: 50_00, netKobo: 50_00 });
  });

  it("derives opening by taking the first transaction's own effect back out of its balance", () => {
    const s = buildStatement(rows, range);
    // 300 after a +100 credit → 200 before. Closing is the last running balance.
    expect(s.periods[0].openingKobo).toBe(200_00);
    expect(s.periods[0].closingKobo).toBe(260_00);
    // 250 after a −10 debit → 260 before.
    expect(s.periods[2].openingKobo).toBe(260_00);
  });

  it("leaves balances null when the bank sent none", () => {
    const s = buildStatement([{ ...rows[0], balanceAfterKobo: null }], range);
    expect(s.periods[0]).toMatchObject({ openingKobo: null, closingKobo: null });
  });

  it("uses UTC month boundaries so 23:59 on the 31st stays in its month", () => {
    const s = buildStatement(
      [{ occurredAt: d("2026-07-31T23:59:59Z"), direction: "credit", amountKobo: 1, balanceAfterKobo: null }],
      range,
    );
    expect(s.periods[0].count).toBe(1);
    expect(s.periods[1].count).toBe(0);
  });

  it("excludes rows outside the requested range", () => {
    const s = buildStatement(rows, { from: d("2026-07-10T00:00:00Z"), to: d("2026-07-31T00:00:00Z") });
    expect(s.totals.count).toBe(1);
  });
});

describe("CSV", () => {
  it("quotes cells containing commas, quotes and newlines", () => {
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("two\nlines")).toBe('"two\nlines"');
  });

  it("neutralises spreadsheet formulas in text cells", () => {
    expect(csvCell("=HYPERLINK(\"http://evil\")")).toBe(`"'=HYPERLINK(""http://evil"")"`);
    expect(csvCell("+1234")).toBe("'+1234");
    expect(csvCell("-cmd")).toBe("'-cmd");
    expect(csvCell("@SUM(A1)")).toBe("'@SUM(A1)");
  });

  it("does not touch numbers or ordinary text", () => {
    expect(csvCell(-5)).toBe("-5");
    expect(csvCell("Salary - Acme")).toBe("Salary - Acme");
    expect(csvCell(null)).toBe("");
  });

  it("starts with a BOM and ends rows with CRLF", () => {
    const out = toCsv(["a", "b"], [["1", "2"]]);
    expect(out.charCodeAt(0)).toBe(0xfeff);
    expect(out.slice(1)).toBe("a,b\r\n1,2\r\n");
  });

  it("formats kobo as plain decimal naira, including negatives and small values", () => {
    expect(nairaFromKobo(2_500_000)).toBe("25000.00");
    expect(nairaFromKobo(5)).toBe("0.05");
    expect(nairaFromKobo(-150)).toBe("-1.50");
    expect(nairaFromKobo(123n)).toBe("1.23");
    expect(nairaFromKobo(null)).toBe("");
  });
});
