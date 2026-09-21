import { createHash } from "node:crypto";
import type { MonoTransaction } from "../integrations/mono/mono.types";

// A bank transaction must be stored once however many times, and over however
// many overlapping windows, we ask Mono for it — otherwise every refresh would
// double the customer's apparent income. So each row gets a stable identity
// within its account: Mono's own id when it sends one (it should), and a hash
// of the transaction's own fields when it doesn't.

export interface PreparedTransaction {
  tx: MonoTransaction;
  externalId: string;
  /** True when we made the id up because Mono sent none. */
  synthetic: boolean;
}

function fingerprint(t: MonoTransaction): string {
  return createHash("sha256")
    .update([t.date, t.type, t.amountKobo, t.narration, t.balanceKobo ?? ""].join("|"))
    .digest("hex")
    .slice(0, 32);
}

/**
 * Attach a stable id to each transaction, dropping repeats of the same
 * provider id inside one response.
 *
 * A synthetic id can't tell two genuinely identical transactions apart (same
 * instant, amount, narration, balance) — so identical fingerprints get an
 * ordinal suffix in the order they arrive. That keeps both, at the cost of the
 * suffix depending on the response's ordering; it only ever matters for
 * responses that lack ids, which is why the suffix is applied to *those* alone.
 */
export function prepareTransactions(txs: MonoTransaction[]): PreparedTransaction[] {
  const seenProviderIds = new Set<string>();
  const ordinals = new Map<string, number>();
  const out: PreparedTransaction[] = [];

  for (const tx of txs) {
    if (tx.id) {
      if (seenProviderIds.has(tx.id)) continue;
      seenProviderIds.add(tx.id);
      out.push({ tx, externalId: tx.id, synthetic: false });
      continue;
    }
    const fp = fingerprint(tx);
    const n = ordinals.get(fp) ?? 0;
    ordinals.set(fp, n + 1);
    out.push({ tx, externalId: n === 0 ? `h:${fp}` : `h:${fp}#${n}`, synthetic: true });
  }
  return out;
}
