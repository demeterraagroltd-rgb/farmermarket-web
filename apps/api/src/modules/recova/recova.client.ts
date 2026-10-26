import { ServiceUnavailableException } from "@nestjs/common";
import { productionConnection } from "./recova-production.config";
import { assertConsentSubmissionEnabled } from "./recova-consent.config";

export const RECOVA_STAGING = "https://staging.recova.ng/recova_ofi_handshake/api";
export type SandboxOperation = "consent" | "mandate" | "create-consent" | "resend-consent" | "cancel-mandate";
const POSTS: ReadonlySet<SandboxOperation> = new Set(["create-consent", "resend-consent", "cancel-mandate"]);

export function assertSandboxEnabled() {
  if (process.env.RECOVA_SANDBOX_ENABLED !== "true") {
    throw new ServiceUnavailableException("Recova sandbox is disabled. Set RECOVA_SANDBOX_ENABLED=true on the API.");
  }
}

function redact(value: unknown, token: string): unknown {
  if (typeof value === "string") return value.split(token).join("[redacted]");
  if (Array.isArray(value)) return value.map((v) => redact(v, token));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k,
    /token|password|secret|authorization/i.test(k) ? "[redacted]" : redact(v, token),
  ]));
  return value;
}

/** Fixed staging destination, no redirect following and no automatic POST retry. */
export async function requestSandbox(operation: SandboxOperation, reference: string, payload?: unknown) {
  assertSandboxEnabled();
  const token = process.env.RECOVA_API_TOKEN?.trim();
  if (!token || /\s/.test(token)) throw new ServiceUnavailableException("Set a bare RECOVA_API_TOKEN on the API (without Bearer).");
  return sendRequest(RECOVA_STAGING, token, "staging", operation, reference, payload);
}

/** Production is intentionally lookup-only. No mutation can reach this path. */
export async function requestProductionLookup(operation: "consent" | "mandate", reference: string) {
  if (operation !== "consent" && operation !== "mandate") throw new ServiceUnavailableException("Production supports read-only lookups only.");
  const { baseUrl, token } = productionConnection();
  return sendRequest(baseUrl, token, "production", operation, reference);
}

/** Called only after a durable loan consent intent has been reserved. */
export async function requestProductionConsent(reference: string, payload: unknown) {
  assertConsentSubmissionEnabled();
  const { baseUrl, token } = productionConnection();
  return sendRequest(baseUrl, token, "production", "create-consent", reference, payload);
}

async function sendRequest(baseUrl: string, token: string, environment: "staging" | "production", operation: SandboxOperation, reference: string, payload?: unknown) {
  const ref = encodeURIComponent(reference);
  const path = {
    "create-consent": "/ConsentRequest/CreateConsentRequest",
    consent: `/ConsentRequest/RetrieveConsentRequestByLoanReference/${ref}`,
    mandate: `/Mandate/RetrieveMandateByLoanReference/${ref}`,
    "resend-consent": `/ConsentRequest/ResendConsentRequestMessage/${ref}`,
    "cancel-mandate": `/Mandate/CancelMandateByLoanReference/${ref}?comment=${encodeURIComponent("Farmer Market sandbox test cleanup")}`,
  }[operation];
  const isPost = POSTS.has(operation);
  try {
    const response = await fetch(`${baseUrl}${path}`, {
      method: isPost ? "POST" : "GET",
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json", "Cache-Control": "no-store", ...(payload ? { "Content-Type": "application/json" } : {}) },
      body: payload ? JSON.stringify(payload) : undefined,
      signal: AbortSignal.timeout(25_000), redirect: "error",
    });
    const raw = await response.text();
    let body: unknown;
    try { body = JSON.parse(raw); } catch { body = raw.slice(0, 2000); }
    return {
      environment, operation, reference, httpStatus: response.status, ok: response.ok,
      authentication: response.status === 401 || response.status === 403 ? "rejected" : "not_verified",
      body: environment === "production" ? maskIdentity(redact(body, token)) : redact(body, token),
      note: response.status === 404 ? "No matching test record or endpoint was found. Inspect the provider message; a 404 alone does not establish token validity."
        : operation === "create-consent" ? "Consent request only. Open consentApprovalUrl as the test customer (no SMS callback is registered yet), then retrieve consent and mandate status. This is not activation or payment confirmation."
        : operation === "cancel-mandate" ? "Retrieve the mandate to confirm its status is Cancelled." : null,
    };
  } catch {
    throw new ServiceUnavailableException(isPost
      ? "No confirmed response from Recova. The request may have arrived: look up this reference before taking further action."
      : "Recova lookup did not complete. Check connectivity and retry the lookup.");
  }
}

function maskIdentity(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(maskIdentity);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => {
    if (/bvn|account(number|no|$)|repaymentaccount|phone|email|taxidentification/i.test(key)) {
      return [key, typeof item === "string" && item ? `***${item.slice(-4)}` : "[redacted]"];
    }
    return [key, maskIdentity(item)];
  }));
  // A non-JSON response can echo identity data without usable field names.
  return typeof value === "string" ? value.replace(/\b\d{10,15}\b/g, "[redacted identifier]") : value;
}
