import { afterEach, describe, expect, it, vi } from "vitest";
import { recovaReadiness } from "./recova-readiness";

afterEach(() => vi.unstubAllEnvs());
function configured() {
  const values = {
    RECOVA_PRODUCTION_BASE_URL: "https://recova.ng/recova_ofi_handshake/api",
    RECOVA_PRODUCTION_INSTITUTION_CODE: "223",
    RECOVA_PRODUCTION_ENABLED: "true",
    RECOVA_PRODUCTION_API_TOKEN: "private-production-token",
    RECOVA_DATA_ENCRYPTION_KEY: Buffer.alloc(32, 2).toString("base64"),
    BVN_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString("base64"),
    RECOVA_WEBHOOK_SECRET: "private-webhook-secret-".repeat(3),
    RECOVA_WEBHOOKS_ENABLED: "true",
    RECOVA_CONSENT_ENABLED: "true",
    RECOVA_CONTRACT_CONFIRMED: "true",
    RECOVA_CONSENT_PURPOSE: "Collection",
    RECOVA_TENURE_UNIT: "months",
    AUTO_DEBIT_ENABLED: "false",
    SMS_PROVIDER: "bulksmsnigeria",
    BULKSMSNIGERIA_API_TOKEN: "private-sms-token",
    BULKSMSNIGERIA_SENDER_ID: "FARMEMARKET",
  };
  for (const [key, value] of Object.entries(values)) vi.stubEnv(key, value);
  return values;
}

describe("Recova readiness evidence", () => {
  it("never treats complete configuration as proof of money movement or provider registration", () => {
    configured();
    const report = recovaReadiness();
    const state = (id: string) => report.checks.find(check => check.id === id)?.state;
    expect(state("consent")).toBe("configured");
    expect(state("sms-config")).toBe("configured");
    for (const id of ["provider-connection", "mandate", "sms-delivery", "webhook-provider", "collection"]) expect(state(id)).toBe("unverified");
    for (const id of ["recovery", "reconciliation", "pilot"]) expect(state(id)).toBe("blocked");
    expect(report.fullyOperational).toBe(false);
    expect(new Set(report.checks.map(check => check.id)).size).toBe(report.checks.length);
  });
  it("reports missing prerequisites and competing automatic debit without enabling consent", () => {
    configured();
    vi.stubEnv("RECOVA_WEBHOOKS_ENABLED", "false");
    vi.stubEnv("RECOVA_CONSENT_PURPOSE", "unknown");
    vi.stubEnv("RECOVA_TENURE_UNIT", "unknown");
    vi.stubEnv("AUTO_DEBIT_ENABLED", "true");
    vi.stubEnv("BULKSMSNIGERIA_API_TOKEN", "");
    const report = recovaReadiness();
    for (const id of ["webhook-switch", "purpose", "tenure", "duplicate-debit", "sms-config"]) {
      expect(report.checks.find(check => check.id === id)?.state).toBe("missing");
    }
    expect(report.checks.find(check => check.id === "consent")?.state).toBe("blocked");
  });
  it("returns no credentials and performs no external requests", () => {
    const values = configured();
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    try {
      const report = JSON.stringify(recovaReadiness());
      for (const key of ["RECOVA_PRODUCTION_API_TOKEN", "RECOVA_DATA_ENCRYPTION_KEY", "BVN_ENCRYPTION_KEY", "RECOVA_WEBHOOK_SECRET", "BULKSMSNIGERIA_API_TOKEN"] as const) {
        expect(report).not.toContain(values[key]);
      }
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally { fetchSpy.mockRestore(); }
  });
});
