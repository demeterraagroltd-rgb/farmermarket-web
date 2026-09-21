import { describe, expect, it } from "vitest";
import { prepareTransactions } from "./transaction-dedupe";
import type { MonoTransaction } from "../integrations/mono/mono.types";

const tx = (over: Partial<MonoTransaction> = {}): MonoTransaction => ({
  id: null,
  category: null,
  amountKobo: 25_000_000,
  type: "credit",
  narration: "SALARY - ACME",
  date: "2026-09-01T00:00:00.000Z",
  balanceKobo: null,
  ...over,
});

describe("prepareTransactions", () => {
  it("uses Mono's own id when there is one", () => {
    const [p] = prepareTransactions([tx({ id: "abc123" })]);
    expect(p.externalId).toBe("abc123");
    expect(p.synthetic).toBe(false);
  });

  it("drops a repeat of the same provider id within one response", () => {
    expect(prepareTransactions([tx({ id: "a" }), tx({ id: "a" }), tx({ id: "b" })])).toHaveLength(2);
  });

  it("makes a stable synthetic id when Mono sent none — same input, same id", () => {
    const a = prepareTransactions([tx()])[0];
    const b = prepareTransactions([tx()])[0];
    expect(a.synthetic).toBe(true);
    expect(a.externalId).toBe(b.externalId);
    expect(a.externalId.startsWith("h:")).toBe(true);
  });

  it("gives different transactions different synthetic ids", () => {
    const ids = prepareTransactions([
      tx(),
      tx({ amountKobo: 1 }),
      tx({ type: "debit" }),
      tx({ narration: "OTHER" }),
      tx({ date: "2026-09-02T00:00:00.000Z" }),
      tx({ balanceKobo: 5 }),
    ]).map((p) => p.externalId);
    expect(new Set(ids).size).toBe(6);
  });

  it("keeps two genuinely identical transactions instead of collapsing them", () => {
    const [a, b, c] = prepareTransactions([tx(), tx(), tx()]);
    expect(new Set([a.externalId, b.externalId, c.externalId]).size).toBe(3);
    expect(a.externalId).not.toContain("#");
    expect(b.externalId.endsWith("#1")).toBe(true);
    expect(c.externalId.endsWith("#2")).toBe(true);
  });

  it("never mixes provider ids with the synthetic counting", () => {
    const out = prepareTransactions([tx({ id: "a" }), tx(), tx({ id: "b" }), tx()]);
    expect(out.filter((p) => p.synthetic)).toHaveLength(2);
    expect(out[0].externalId).toBe("a");
  });
});
