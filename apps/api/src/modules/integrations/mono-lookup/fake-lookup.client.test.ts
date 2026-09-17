import { describe, expect, it } from "vitest";
import { FakeLookupClient, FAKE_LOOKUP_OTP } from "./fake-lookup.client";

// The fake is what every offline run of the BVN flow exercises, so its stage
// ordering has to hold as tightly as the real client's — a fake that accepts
// anything would let a broken consent flow ship.
describe("FakeLookupClient", () => {
  const bvn = "22222222222";

  it("walks initiate → send OTP → fetch", async () => {
    const c = new FakeLookupClient();
    const { sessionId, methods } = await c.initiateBvn(bvn);
    expect(sessionId).toMatch(/^sess_fake_/);
    expect(methods.map((m) => m.method)).toContain("alternate_phone");

    await c.sendBvnOtp(sessionId, "phone");
    const record = await c.fetchBvn(sessionId, FAKE_LOOKUP_OTP);
    expect(record.source).toBe("bvn");
    expect(record.lastName).toBe("OKONKWO");
  });

  it("rejects a wrong OTP", async () => {
    const c = new FakeLookupClient();
    const { sessionId } = await c.initiateBvn(bvn);
    await expect(c.fetchBvn(sessionId, "000000")).rejects.toThrow(/incorrect OTP/i);
  });

  it("refuses a session it never issued", async () => {
    const c = new FakeLookupClient();
    await expect(c.sendBvnOtp("sess_made_up", "phone")).rejects.toThrow(/invalid or expired/i);
    await expect(c.fetchBvn("sess_made_up", FAKE_LOOKUP_OTP)).rejects.toThrow(/invalid or expired/i);
  });

  it("spends a session on success so an OTP can't be replayed", async () => {
    const c = new FakeLookupClient();
    const { sessionId } = await c.initiateBvn(bvn);
    await c.fetchBvn(sessionId, FAKE_LOOKUP_OTP);
    await expect(c.fetchBvn(sessionId, FAKE_LOOKUP_OTP)).rejects.toThrow(/invalid or expired/i);
  });

  it("validates BVN and NIN shape", async () => {
    const c = new FakeLookupClient();
    await expect(c.initiateBvn("123")).rejects.toThrow(/11 digits/);
    await expect(c.lookupNin("abc")).rejects.toThrow(/11 digits/);
  });

  it("reports itself as not live so results are never trusted", () => {
    expect(new FakeLookupClient().live).toBe(false);
  });

  it("returns the same person from NIN as from BVN, so the two corroborate", async () => {
    const c = new FakeLookupClient();
    const { sessionId } = await c.initiateBvn(bvn);
    const fromBvn = await c.fetchBvn(sessionId, FAKE_LOOKUP_OTP);
    const fromNin = await c.lookupNin("22222222222");
    expect(fromNin.lastName).toBe(fromBvn.lastName);
    expect(fromNin.dateOfBirth).toBe(fromBvn.dateOfBirth);
    expect(fromNin.source).toBe("nin");
  });
});
