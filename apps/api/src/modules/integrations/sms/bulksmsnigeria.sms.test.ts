import "reflect-metadata";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BulkSmsNigeriaSender } from "./bulksmsnigeria.sms";
import { createSmsSender } from "./sms.module";

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
const config = { apiToken: "private-fixture-token", senderId: "FarmerMkt" };
const success = { status: "success", code: "BSNG-0000", data: { message_id: "fixture-id", recipients_count: 1, gateway_used: "corporate" } };
describe("BulkSMSNigeria delivery", () => {
  it("uses the transactional route, bearer header and one normalized recipient", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(success))); vi.stubGlobal("fetch", fetch);
    await new BulkSmsNigeriaSender(config).send("2348000000001", "Test consent link");
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith("https://www.bulksmsnigeria.com/api/v2/sms", expect.objectContaining({
      method: "POST", redirect: "error", headers: expect.objectContaining({ Authorization: "Bearer private-fixture-token" }),
      body: JSON.stringify({ from: "FarmerMkt", to: "2348000000001", body: "Test consent link", gateway: "corporate", unicode: false }),
    }));
  });
  it("rejects HTTP-200 business errors without exposing provider echoes", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ status: "error", message: "private-fixture-token secret OTP" }))));
    const error = await new BulkSmsNigeriaSender(config).send("2348000000001", "private OTP").catch(e => e);
    expect(error.message).toContain("did not confirm acceptance");
    expect(error.message).not.toContain("private-fixture-token"); expect(error.message).not.toContain("OTP");
  });
  it.each([401, 409, 422, 500])("never retries an HTTP %s", async status => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ status: "error" }), { status })); vi.stubGlobal("fetch", fetch);
    await expect(new BulkSmsNigeriaSender(config).send("2348000000001", "Message")).rejects.toThrow("Check the provider dashboard");
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("does not retry a timed out send or a malformed response", async () => {
    const fetch = vi.fn().mockRejectedValue(new Error("request contained private-fixture-token")); vi.stubGlobal("fetch", fetch);
    await expect(new BulkSmsNigeriaSender(config).send("2348000000001", "Message")).rejects.toThrow("delivery is unconfirmed");
    expect(fetch).toHaveBeenCalledTimes(1);
    fetch.mockResolvedValue(new Response("not json"));
    await expect(new BulkSmsNigeriaSender(config).send("2348000000001", "Message")).rejects.toThrow("delivery is unconfirmed");
  });
  it("surfaces unexpected fallback routes and partial recipient acceptance", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ ...success, data: { ...success.data, gateway_used: "direct-refund" } }))));
    await expect(new BulkSmsNigeriaSender(config).send("2348000000001", "Message")).rejects.toThrow("unexpected route");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ ...success, data: { ...success.data, recipients_count: 0 } }))));
    await expect(new BulkSmsNigeriaSender(config).send("2348000000001", "Message")).rejects.toThrow("did not confirm acceptance");
  });
  it("accepts the documented provider fallback without retrying an already accepted message", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ...success, data: {
      ...success.data, gateway_used: "direct-refund", requested_gateway: "corporate", route_notice: "Requested route unavailable; accepted on direct-refund",
    } })));
    vi.stubGlobal("fetch", fetch);
    await expect(new BulkSmsNigeriaSender(config).send("2348000000001", "Message")).resolves.toBeUndefined();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("validates configuration and recipient before any network request", async () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    expect(() => new BulkSmsNigeriaSender({ ...config, apiToken: "" })).toThrow("API_TOKEN");
    expect(() => new BulkSmsNigeriaSender({ ...config, senderId: "FarmerMarket" })).toThrow("1–11");
    await expect(new BulkSmsNigeriaSender(config).send("08000000001", "Message")).rejects.toThrow("234 format");
    expect(fetch).not.toHaveBeenCalled();
  });
  it("uses the explicitly selected provider and fails closed when its token is absent", () => {
    vi.stubEnv("SMS_PROVIDER", "bulksmsnigeria"); vi.stubEnv("TERMII_API_KEY", "termii-fixture");
    vi.stubEnv("BULKSMSNIGERIA_API_TOKEN", ""); vi.stubEnv("BULKSMSNIGERIA_SENDER_ID", "FarmerMkt");
    expect(() => createSmsSender()).toThrow("API_TOKEN");
    vi.stubEnv("BULKSMSNIGERIA_API_TOKEN", config.apiToken);
    expect(createSmsSender()).toBeInstanceOf(BulkSmsNigeriaSender);
  });
});
