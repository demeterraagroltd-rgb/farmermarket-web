export interface CatalogPricingRates {
  markupPercent: number;
  insurancePercent: number;
}

export const DEFAULT_CATALOG_PRICING: CatalogPricingRates = { markupPercent: 10, insurancePercent: 1 };

function basisPoints(percent: number): bigint {
  if (!Number.isFinite(percent) || percent < 0 || percent > 1000 || Math.abs(percent * 100 - Math.round(percent * 100)) > 0.000001) {
    throw new RangeError("Use a percentage between 0 and 1000 with at most two decimal places");
  }
  return BigInt(Math.round(percent * 100));
}

/** Excel: selling = cost * (1 + markup); insurance = selling * insurance rate.
 * Keep both multiplications exact and round only the final charge to kobo. */
export function calculateCatalogPrice(costKobo: bigint, rates: CatalogPricingRates) {
  if (costKobo <= 0n) throw new RangeError("Cost must be positive");
  const sellingNumerator = costKobo * (10000n + basisPoints(rates.markupPercent));
  const insuranceNumerator = sellingNumerator * basisPoints(rates.insurancePercent);
  const round = (n: bigint, divisor: bigint) => (n + divisor / 2n) / divisor;
  return {
    sellingKobo: round(sellingNumerator, 10000n),
    insuranceKobo: round(insuranceNumerator, 100000000n),
    priceKobo: round(sellingNumerator * 10000n + insuranceNumerator, 100000000n),
  };
}
