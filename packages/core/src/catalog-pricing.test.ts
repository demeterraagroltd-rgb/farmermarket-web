import { describe, expect, it } from "vitest";
import { calculateCatalogPrice, DEFAULT_CATALOG_PRICING } from "./catalog-pricing.js";

describe("catalog markup and insurance", () => {
  it("calculates insurance on selling price, matching the workbook", () => {
    expect(calculateCatalogPrice(5770000n, DEFAULT_CATALOG_PRICING)).toEqual({
      sellingKobo: 6347000n, insuranceKobo: 63470n, priceKobo: 6410470n,
    });
  });
  it("supports zero and fractional percentages and rounds only the final charge", () => {
    expect(calculateCatalogPrice(12345n, { markupPercent: 0, insurancePercent: 0 }).priceKobo).toBe(12345n);
    expect(calculateCatalogPrice(1n, { markupPercent: 50, insurancePercent: 50 }).priceKobo).toBe(2n);
    expect(calculateCatalogPrice(10000n, { markupPercent: 12.5, insurancePercent: 1.25 }).priceKobo).toBe(11391n);
  });
  it("rejects missing/negative costs and invalid rates", () => {
    expect(() => calculateCatalogPrice(0n, DEFAULT_CATALOG_PRICING)).toThrow();
    for (const rate of [-1, NaN, Infinity, 1.234, 1001]) {
      expect(() => calculateCatalogPrice(100n, { markupPercent: rate, insurancePercent: 1 })).toThrow();
    }
  });
});
