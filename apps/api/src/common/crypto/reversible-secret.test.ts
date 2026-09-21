import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { decryptSecretOrNull, encryptSecret, hasEncryptionKey } from "./reversible-secret";

const KEY_A = Buffer.alloc(32, 1).toString("base64");
const KEY_B = Buffer.alloc(32, 2).toString("base64");
const original = process.env.BVN_ENCRYPTION_KEY;

describe("reversible-secret", () => {
  afterEach(() => {
    if (original === undefined) delete process.env.BVN_ENCRYPTION_KEY;
    else process.env.BVN_ENCRYPTION_KEY = original;
  });

  it("round-trips a value under the same key", () => {
    process.env.BVN_ENCRYPTION_KEY = KEY_A;
    const enc = encryptSecret("22222222222");
    expect(enc).not.toContain("22222222222");
    expect(decryptSecretOrNull(enc)).toBe("22222222222");
  });

  it("reports no key as unavailable rather than throwing on decrypt", () => {
    delete process.env.BVN_ENCRYPTION_KEY;
    expect(hasEncryptionKey()).toBe(false);
    expect(decryptSecretOrNull("whatever:whatever:whatever")).toBeNull();
  });

  it("throws on encrypt with no key — callers must check hasEncryptionKey() first", () => {
    delete process.env.BVN_ENCRYPTION_KEY;
    expect(() => encryptSecret("x")).toThrow(/BVN_ENCRYPTION_KEY/);
  });

  it("degrades to null, not a crash, once the key has rotated", () => {
    process.env.BVN_ENCRYPTION_KEY = KEY_A;
    const enc = encryptSecret("22222222222");
    process.env.BVN_ENCRYPTION_KEY = KEY_B;
    expect(decryptSecretOrNull(enc)).toBeNull();
  });

  it("degrades to null on garbage input instead of throwing", () => {
    process.env.BVN_ENCRYPTION_KEY = KEY_A;
    expect(decryptSecretOrNull(null)).toBeNull();
    expect(decryptSecretOrNull("")).toBeNull();
    expect(decryptSecretOrNull("not-the-right-shape")).toBeNull();
  });

  it("rejects a key that isn't exactly 32 bytes", () => {
    process.env.BVN_ENCRYPTION_KEY = Buffer.alloc(16, 1).toString("base64");
    expect(() => encryptSecret("x")).toThrow(/32 bytes/);
  });
});

describe("independent keys", () => {
  const RAW = "MONO_RAW_ENCRYPTION_KEY";
  const rawKey = Buffer.alloc(32, 7).toString("base64");
  const saved = { bvn: process.env.BVN_ENCRYPTION_KEY, raw: process.env[RAW] };
  afterEach(() => {
    if (saved.bvn === undefined) delete process.env.BVN_ENCRYPTION_KEY;
    else process.env.BVN_ENCRYPTION_KEY = saved.bvn;
    if (saved.raw === undefined) delete process.env[RAW];
    else process.env[RAW] = saved.raw;
  });

  it("uses each variable for its own purpose", () => {
    process.env.BVN_ENCRYPTION_KEY = KEY_A;
    process.env[RAW] = rawKey;
    const enc = encryptSecret("payload", RAW);
    expect(decryptSecretOrNull(enc, RAW)).toBe("payload");
  });

  it("does not let the BVN key open something sealed with the raw-response key", () => {
    process.env.BVN_ENCRYPTION_KEY = KEY_A;
    process.env[RAW] = rawKey;
    const enc = encryptSecret("payload", RAW);
    expect(decryptSecretOrNull(enc)).toBeNull(); // default = the BVN key
  });

  it("reports each key independently", () => {
    process.env.BVN_ENCRYPTION_KEY = KEY_A;
    delete process.env[RAW];
    expect(hasEncryptionKey()).toBe(true);
    expect(hasEncryptionKey(RAW)).toBe(false);
  });

  it("names the right variable when one is missing or malformed", () => {
    delete process.env[RAW];
    expect(() => encryptSecret("x", RAW)).toThrow(/MONO_RAW_ENCRYPTION_KEY/);
    process.env[RAW] = Buffer.alloc(8).toString("base64");
    expect(() => encryptSecret("x", RAW)).toThrow(/MONO_RAW_ENCRYPTION_KEY must decode/);
  });
});
