/**
 * Money is always `bigint` kobo, never `number`/float (§5, §16 — "Money
 * handled as floats" is a named risk). ₦1 = 100 kobo. These are the only
 * sanctioned conversion points between kobo and naira display strings.
 */

export function nairaToKobo(naira: number): bigint {
  if (!Number.isFinite(naira)) {
    throw new RangeError(`nairaToKobo: not finite: ${naira}`);
  }
  return BigInt(Math.round(naira * 100));
}

export function koboToNaira(kobo: bigint): number {
  return Number(kobo) / 100;
}

export function formatNaira(kobo: bigint): string {
  return new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency: "NGN",
    currencyDisplay: "narrowSymbol",
  }).format(koboToNaira(kobo));
}

export function addKobo(...amounts: bigint[]): bigint {
  return amounts.reduce((sum, amount) => sum + amount, 0n);
}

export function percentOfKobo(kobo: bigint, percent: number): bigint {
  // Integer-safe: scale by 10000 (2 decimal places of percent) then divide back.
  return (kobo * BigInt(Math.round(percent * 100))) / 10000n;
}
