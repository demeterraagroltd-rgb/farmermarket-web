import { afterEach, describe, expect, it, vi } from "vitest";
import { requestSandbox } from "./recova.client";

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
describe("Recova staging transport", () => {
  it("fails closed without the sandbox flag", async () => {
    vi.stubEnv("RECOVA_SANDBOX_ENABLED", "false");
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    await expect(requestSandbox("mandate", "fm-sandbox-test")).rejects.toThrow("disabled");
    expect(fetch).not.toHaveBeenCalled();
  });
  it("uses only staging, rejects redirects and does not claim 404 validates the token", async () => {
    vi.stubEnv("RECOVA_SANDBOX_ENABLED", "true"); vi.stubEnv("RECOVA_API_TOKEN", "unit-test-secret");
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: "not found", token: "unit-test-secret" }), { status: 404 }));
    vi.stubGlobal("fetch", fetch);
    const result = await requestSandbox("mandate", "fm-sandbox-test");
    expect(fetch).toHaveBeenCalledWith("https://staging.recova.ng/recova_ofi_handshake/api/Mandate/RetrieveMandateByLoanReference/fm-sandbox-test", expect.objectContaining({ redirect: "error", method: "GET" }));
    expect(result).toMatchObject({ httpStatus: 404, ok: false, authentication: "not_verified", body: { token: "[redacted]" } });
  });
  it("sends resend and cancel as single POSTs to the documented paths", async () => {
    vi.stubEnv("RECOVA_SANDBOX_ENABLED", "true"); vi.stubEnv("RECOVA_API_TOKEN", "unit-test-secret");
    const fetch = vi.fn().mockImplementation(async () => new Response("{}", { status: 200 })); vi.stubGlobal("fetch", fetch);
    await requestSandbox("resend-consent", "fm-sandbox-test");
    await requestSandbox("cancel-mandate", "fm-sandbox-test");
    expect(fetch.mock.calls[0][0]).toBe("https://staging.recova.ng/recova_ofi_handshake/api/ConsentRequest/ResendConsentRequestMessage/fm-sandbox-test");
    expect(fetch.mock.calls[1][0]).toMatch(/\/Mandate\/CancelMandateByLoanReference\/fm-sandbox-test\?comment=/);
    expect(fetch.mock.calls.every(([, init]) => init.method === "POST")).toBe(true);
  });
  it("never retries an ambiguous consent submission or leaks its token", async () => {
    vi.stubEnv("RECOVA_SANDBOX_ENABLED", "true"); vi.stubEnv("RECOVA_API_TOKEN", "unit-test-secret");
    const fetch = vi.fn().mockRejectedValue(new Error("unit-test-secret")); vi.stubGlobal("fetch", fetch);
    await expect(requestSandbox("create-consent", "fm-sandbox-test", {})).rejects.toThrow("may have arrived");
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
