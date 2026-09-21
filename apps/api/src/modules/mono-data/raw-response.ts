import { gunzipSync, gzipSync } from "node:zlib";
import {
  decryptSecretOrNull,
  encryptSecret,
  hasEncryptionKey,
  MONO_RAW_KEY_VAR,
} from "../../common/crypto/reversible-secret";

// Mono's original responses, sealed for audit and debugging. They hold the
// account holder's name, balances and a year of transactions, so they are
// gzipped (a transaction list compresses ~10x) and AES-256-GCM encrypted under
// MONO_RAW_ENCRYPTION_KEY — a key separate from the BVN one.
//
// With no key configured nothing is sealed and nothing is stored: the
// normalised tables carry everything the product uses, so a missing key costs
// the audit copy, never the feature.

export interface SealedRaw {
  encrypted: string;
  /** Size of the JSON before gzip and encryption. */
  bytes: number;
}

export function rawStorageEnabled(): boolean {
  return hasEncryptionKey(MONO_RAW_KEY_VAR);
}

export function sealRaw(payload: unknown): SealedRaw | null {
  if (!rawStorageEnabled()) return null;
  const json = JSON.stringify(payload ?? null);
  const gz = gzipSync(Buffer.from(json, "utf8"));
  return { encrypted: encryptSecret(gz.toString("base64"), MONO_RAW_KEY_VAR), bytes: Buffer.byteLength(json) };
}

/** Null on a missing/rotated key or a corrupt value — never throws. */
export function openRaw(encrypted: string): unknown | null {
  const b64 = decryptSecretOrNull(encrypted, MONO_RAW_KEY_VAR);
  if (!b64) return null;
  try {
    return JSON.parse(gunzipSync(Buffer.from(b64, "base64")).toString("utf8"));
  } catch {
    return null;
  }
}

// ── Retention ────────────────────────────────────────────────────────────

/** Rolling window of transactions kept per account. */
export const DEFAULT_TRANSACTION_RETENTION_MONTHS = 12;
/** How long a raw response is kept before it is deleted. */
export const DEFAULT_RAW_RETENTION_DAYS = 90;

function positiveInt(v: string | undefined, fallback: number): number {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

export function retentionConfig(env: NodeJS.ProcessEnv = process.env) {
  return {
    transactionMonths: positiveInt(env.MONO_TRANSACTION_RETENTION_MONTHS, DEFAULT_TRANSACTION_RETENTION_MONTHS),
    rawDays: positiveInt(env.MONO_RAW_RETENTION_DAYS, DEFAULT_RAW_RETENTION_DAYS),
  };
}

export function rawExpiry(now: Date, days: number): Date {
  return new Date(now.getTime() + days * 86_400_000);
}

export function transactionCutoff(now: Date, months: number): Date {
  const d = new Date(now);
  d.setMonth(d.getMonth() - months);
  return d;
}
