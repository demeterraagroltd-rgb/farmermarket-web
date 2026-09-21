import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_RAW_RETENTION_DAYS,
  DEFAULT_TRANSACTION_RETENTION_MONTHS,
  openRaw,
  rawExpiry,
  rawStorageEnabled,
  retentionConfig,
  sealRaw,
  transactionCutoff,
} from "./raw-response";

const KEY = Buffer.alloc(32, 9).toString("base64");
const saved = process.env.MONO_RAW_ENCRYPTION_KEY;
afterEach(() => {
  if (saved === undefined) delete process.env.MONO_RAW_ENCRYPTION_KEY;
  else process.env.MONO_RAW_ENCRYPTION_KEY = saved;
});

describe("sealed raw responses", () => {
  it("round-trips, and the sealed form leaks nothing readable", () => {
    process.env.MONO_RAW_ENCRYPTION_KEY = KEY;
    const payload = { data: [{ narration: "SALARY - ACME CORP LTD", amount: 25_000_000 }], holder: "ADA OKONKWO" };
    const sealed = sealRaw(payload)!;
    expect(sealed.encrypted).not.toContain("ADA");
    expect(sealed.encrypted).not.toContain("SALARY");
    expect(openRaw(sealed.encrypted)).toEqual(payload);
    expect(sealed.bytes).toBe(Buffer.byteLength(JSON.stringify(payload)));
  });

  it("compresses a repetitive transaction list well below its size", () => {
    process.env.MONO_RAW_ENCRYPTION_KEY = KEY;
    const many = {
      data: Array.from({ length: 2000 }, (_, i) => ({ id: `t${i}`, narration: "POS PURCHASE LAGOS", amount: 150000, type: "debit" })),
    };
    const sealed = sealRaw(many)!;
    expect(sealed.encrypted.length).toBeLessThan(sealed.bytes / 3);
  });

  it("stores nothing at all when no key is configured", () => {
    delete process.env.MONO_RAW_ENCRYPTION_KEY;
    expect(rawStorageEnabled()).toBe(false);
    expect(sealRaw({ a: 1 })).toBeNull();
  });

  it("opens to null — not an exception — after the key is lost or changed", () => {
    process.env.MONO_RAW_ENCRYPTION_KEY = KEY;
    const sealed = sealRaw({ a: 1 })!;
    process.env.MONO_RAW_ENCRYPTION_KEY = Buffer.alloc(32, 1).toString("base64");
    expect(openRaw(sealed.encrypted)).toBeNull();
    delete process.env.MONO_RAW_ENCRYPTION_KEY;
    expect(openRaw(sealed.encrypted)).toBeNull();
    expect(openRaw("garbage")).toBeNull();
  });
});

describe("retention", () => {
  it("defaults to 12 months of transactions and 90 days of raw responses", () => {
    expect(retentionConfig({})).toEqual({
      transactionMonths: DEFAULT_TRANSACTION_RETENTION_MONTHS,
      rawDays: DEFAULT_RAW_RETENTION_DAYS,
    });
    expect(DEFAULT_TRANSACTION_RETENTION_MONTHS).toBe(12);
    expect(DEFAULT_RAW_RETENTION_DAYS).toBe(90);
  });
  it("honours overrides, ignoring nonsense", () => {
    expect(
      retentionConfig({ MONO_TRANSACTION_RETENTION_MONTHS: "6", MONO_RAW_RETENTION_DAYS: "30" } as never),
    ).toEqual({ transactionMonths: 6, rawDays: 30 });
    expect(
      retentionConfig({ MONO_TRANSACTION_RETENTION_MONTHS: "-3", MONO_RAW_RETENTION_DAYS: "abc" } as never),
    ).toEqual({ transactionMonths: 12, rawDays: 90 });
  });
  it("computes the cut-offs", () => {
    const now = new Date("2026-09-21T12:00:00.000Z");
    expect(rawExpiry(now, 90).toISOString()).toBe("2026-12-20T12:00:00.000Z");
    expect(transactionCutoff(now, 12).toISOString()).toBe("2025-09-21T12:00:00.000Z");
  });
});
