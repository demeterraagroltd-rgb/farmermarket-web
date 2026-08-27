import { describe, expect, it, vi } from "vitest";
import { LedgerService } from "./ledger.service";

// Mimics tx.select().from().where().limit() → [] (account doesn't exist
// yet) and tx.insert().values().returning() → [{ id }], which is all
// LedgerService.post() needs from its `tx` parameter.
function makeTx(insertedValues: unknown[]) {
  let accountCounter = 0;
  return {
    select: () => ({
      from: () => ({ where: () => ({ limit: () => Promise.resolve([]) }) }),
    }),
    insert: (table: unknown) => ({
      values: (values: unknown) => {
        insertedValues.push({ table, values });
        return {
          returning: () => Promise.resolve([{ id: `account-${accountCounter++}` }]),
        };
      },
    }),
  } as any;
}

describe("LedgerService.post", () => {
  it("rejects legs that don't balance — this is the whole point of the check (§5.4)", async () => {
    const service = new LedgerService();
    const tx = makeTx([]);
    await expect(
      service.post(tx, "txn-1", [
        { accountName: "Loans Receivable", accountType: "asset", direction: "D", amountKobo: 1000n },
        { accountName: "Sales Revenue", accountType: "revenue", direction: "C", amountKobo: 999n },
      ]),
    ).rejects.toThrow(/do not balance/);
  });

  it("accepts balanced legs and posts one row per leg", async () => {
    const service = new LedgerService();
    const inserted: unknown[] = [];
    const tx = makeTx(inserted);
    await service.post(tx, "txn-1", [
      { accountName: "Loans Receivable", accountType: "asset", direction: "D", amountKobo: 1000n },
      { accountName: "Sales Revenue", accountType: "revenue", direction: "C", amountKobo: 1000n },
    ]);
    // Two get-or-create account inserts plus one ledger_entries insert.
    const entryInsert = inserted.find((i: any) => Array.isArray(i.values));
    expect((entryInsert as any).values).toHaveLength(2);
  });
});
