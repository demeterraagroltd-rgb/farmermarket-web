import { ServiceUnavailableException } from "@nestjs/common";
import { hasEncryptionKey } from "../../common/crypto/reversible-secret";
import { productionStatus } from "./recova-production.config";

export const RECOVA_DATA_KEY = "RECOVA_DATA_ENCRYPTION_KEY";
export const CONSENT_VERSION = "recova-loan-consent-v1";

export function consentSetupStatus() {
  const production = productionStatus();
  const issues = [...production.issues];
  const purpose = process.env.RECOVA_CONSENT_PURPOSE;
  const tenureUnit = process.env.RECOVA_TENURE_UNIT;
  let draftAvailable = false;
  try { draftAvailable = hasEncryptionKey(RECOVA_DATA_KEY); } catch { /* invalid key is unavailable */ }
  if (!draftAvailable) issues.push("Repayment setup encryption is not configured.");
  if (process.env.RECOVA_CONSENT_ENABLED !== "true") issues.push("Live consent requests are not enabled.");
  if (process.env.RECOVA_CONTRACT_CONFIRMED !== "true") issues.push("Recova production consent and collection behaviour need confirmation.");
  if (purpose !== "Collection" && purpose !== "Recovery") issues.push("The mandate purpose needs confirmation.");
  if (tenureUnit !== "months" && tenureUnit !== "days") issues.push("The provider's loan tenure units need confirmation.");
  if (process.env.AUTO_DEBIT_ENABLED === "true") issues.push("Disable Mono automatic repayment before enabling Recova consent.");
  if (process.env.RECOVA_WEBHOOKS_ENABLED !== "true" || !process.env.RECOVA_WEBHOOK_SECRET || process.env.RECOVA_WEBHOOK_SECRET.length < 32)
    issues.push("Authenticated Recova callbacks are not configured.");
  return { draftAvailable, submissionEnabled: issues.length === 0, purpose: purpose === "Recovery" ? "Recovery" as const : "Collection" as const, tenureUnit, issues };
}

export function assertConsentSubmissionEnabled() {
  const status = consentSetupStatus();
  if (!status.submissionEnabled) throw new ServiceUnavailableException(status.issues.join(" "));
  return status;
}

/** Provider links are capabilities: permit only the confirmed provider host. */
export function safeConsentUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")
      || !(url.hostname === "recova.ng" || url.hostname.endsWith(".recova.ng"))
      || /(^|[.-])(staging|sandbox|test)([.-]|$)/i.test(url.hostname)) return null;
    return url.href;
  } catch { return null; }
}
