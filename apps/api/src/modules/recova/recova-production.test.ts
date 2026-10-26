import { afterEach, describe, expect, it, vi } from "vitest";
import { productionStatus } from "./recova-production.config";
import { requestProductionLookup } from "./recova.client";

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
function configure() {
  // Fixture URL is mocked; it is not a verified provider production endpoint.
  vi.stubEnv("RECOVA_PRODUCTION_BASE_URL", "https://recova.ng/fixture/api/");
  vi.stubEnv("RECOVA_PRODUCTION_API_TOKEN", "production-fixture-secret");
  vi.stubEnv("RECOVA_PRODUCTION_ENABLED", "true");
  vi.stubEnv("RECOVA_PRODUCTION_INSTITUTION_CODE", "223");
}
describe("Recova production connection", () => {
  it("does not reuse the sandbox token", async () => {
    configure(); vi.stubEnv("RECOVA_PRODUCTION_API_TOKEN", ""); vi.stubEnv("RECOVA_API_TOKEN", "sandbox-secret");
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    await expect(requestProductionLookup("mandate", "loan-1")).rejects.toThrow("production bearer token");
    expect(fetch).not.toHaveBeenCalled();
  });
  it("makes no request until production is explicitly enabled", async () => {
    configure(); vi.stubEnv("RECOVA_PRODUCTION_ENABLED", "false");
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    await expect(requestProductionLookup("consent", "loan-1")).rejects.toThrow("disabled");
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each([
    "http://recova.ng/api", "https://staging.recova.ng/api", "https://recova.ng.attacker.example/api",
    "https://localhost/api", "https://user:password@recova.ng/api", "https://recova.ng/api?token=secret",
    "https://recova.ng/api#secret", "https://recova.ng:8443/api",
  ])("rejects an unsafe or staging destination: %s", async (url) => {
    configure(); vi.stubEnv("RECOVA_PRODUCTION_BASE_URL", url);
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    await expect(requestProductionLookup("mandate", "loan-1")).rejects.toThrow("confirmed HTTPS");
    expect(fetch).not.toHaveBeenCalled();
    expect(productionStatus().destination).toBeNull();
  });
  it("only sends GET with production credentials and masks sensitive identifiers", async () => {
    configure();
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ bvn: "12345678901", preferredRepaymentAccount: "1234567890", status: "Active", token: "production-fixture-secret" })));
    vi.stubGlobal("fetch", fetch);
    const result = await requestProductionLookup("mandate", "loan-1");
    expect(fetch).toHaveBeenCalledWith("https://recova.ng/fixture/api/Mandate/RetrieveMandateByLoanReference/loan-1", expect.objectContaining({
      method: "GET", redirect: "error", headers: expect.objectContaining({ Authorization: "Bearer production-fixture-secret", "Cache-Control": "no-store" }),
    }));
    expect(result).toMatchObject({ environment: "production", body: { bvn: "***8901", preferredRepaymentAccount: "***7890", status: "Active", token: "[redacted]" } });
    expect(JSON.stringify(productionStatus())).not.toContain("production-fixture-secret");
  });
  it("rejects mutations even when an untyped caller requests one", async () => {
    configure(); const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    await expect(requestProductionLookup("create-consent" as "mandate", "loan-1")).rejects.toThrow("read-only");
    expect(fetch).not.toHaveBeenCalled();
  });
});
