import { describe, it, expect } from "vitest";
import { validateCatalogImage } from "./catalog-image";

describe("catalog image validation", () => {
  it("rejects missing files and disguised non-images", () => {
    expect(() => validateCatalogImage()).toThrow();
    expect(() => validateCatalogImage({ buffer: Buffer.from("<script>"), size: 8, mimetype: "image/png" })).toThrow();
  });
  it("rejects oversized uploads", () => {
    expect(() => validateCatalogImage({ buffer: Buffer.from([255,216,255]), size: 6 * 1024 * 1024, mimetype: "image/jpeg" })).toThrow();
  });
  it("accepts supported image signatures and rejects mismatched MIME types", () => {
    const buffer = Buffer.from([137,80,78,71,13,10,26,10]);
    expect(() => validateCatalogImage({ buffer, size: 8, mimetype: "image/png" })).not.toThrow();
    expect(() => validateCatalogImage({ buffer, size: 8, mimetype: "image/jpeg" })).toThrow();
  });
});
