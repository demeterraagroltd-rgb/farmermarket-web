import { afterEach, describe, expect, it, vi } from "vitest";
import * as argon2 from "argon2";
import { encryptSecret } from "../../common/crypto/reversible-secret";
import { KycService } from "./kyc.service";

afterEach(() => vi.unstubAllEnvs());

describe("startBvnLookup", () => {
  const bvn = "12345678901";
  const setup = (profile: object) => {
    const initiateBvn = vi.fn().mockResolvedValue({ sessionId: "session", methods: [
      { method: "sms", hint: "***1234" },
      { method: "alternate_phone", hint: null },
      { method: "email", hint: "***@example.com" },
    ] });
    const service = Object.assign(Object.create(KycService.prototype), {
      getProfileRow: vi.fn().mockResolvedValue(profile),
      lookup: { initiateBvn, live: true },
      bvnConsents: new Map(),
    }) as KycService;
    return { service, initiateBvn };
  };

  it("uses the saved BVN and returns verification options without exposing it", async () => {
    vi.stubEnv("BVN_ENCRYPTION_KEY", Buffer.alloc(32, 1).toString("base64"));
    const { service, initiateBvn } = setup({
      bvnEncrypted: encryptSecret(bvn), bvnHash: await argon2.hash(bvn),
    });
    const result = await service.startBvnLookup("user");
    expect(initiateBvn).toHaveBeenCalledWith(bvn);
    expect(result.methods).toEqual([{ method: "sms", hint: "***1234" }]);
    expect(JSON.stringify(result)).not.toContain(bvn);
  });

  it("requires re-entry when a saved number cannot be recovered", async () => {
    const { service, initiateBvn } = setup({ bvnEncrypted: null, bvnHash: "legacy" });
    await expect(service.startBvnLookup("user")).rejects.toThrow("cannot be recovered");
    expect(initiateBvn).not.toHaveBeenCalled();
  });

  it("blocks code delivery to a nominated phone or email", async () => {
    const { service } = setup({});
    await expect(service.sendBvnLookupOtp("user", "alternate_phone", "08012345678")).rejects.toThrow("linked to your BVN");
    await expect(service.sendBvnLookupOtp("user", "email")).rejects.toThrow("linked to your BVN");
    await expect(service.sendBvnLookupOtp("user", "phone", "08012345678")).rejects.toThrow("linked to your BVN");
  });

  it("rejects re-entry of a different BVN", async () => {
    const { service, initiateBvn } = setup({ bvnHash: await argon2.hash(bvn) });
    await expect(service.startBvnLookup("user", "10987654321")).rejects.toThrow("doesn't match");
    expect(initiateBvn).not.toHaveBeenCalled();
  });
});
