import { productionStatus } from "./recova-production.config";
import { consentSetupStatus } from "./recova-consent.config";
import { hasEncryptionKey, BVN_KEY_VAR } from "../../common/crypto/reversible-secret";

type CheckState = "configured" | "missing" | "blocked" | "unverified";
type Check = { id: string; group: string; title: string; state: CheckState; detail: string; nextStep: string; owner: string };

/** Configuration evidence only: no provider calls, messages, or ledger changes.
 * Never infer delivery, provider registration, or financial readiness from env flags. */
export function recovaReadiness() {
  const production = productionStatus();
  const setup = consentSetupStatus();
  const checks: Check[] = [];
  const add = (id: string, group: string, title: string, state: CheckState, detail: string, nextStep: string, owner = "Farmer Market technical team") =>
    checks.push({ id, group, title, state, detail, nextStep, owner });
  const configured = (id: string, group: string, title: string, value: boolean, detail: string, action: string) =>
    add(id, group, title, value ? "configured" : "missing", value ? detail : action, value ? "Configuration saved; this is not a live test result." : action);
  const connection = "Production connection";
  configured("api-url", connection, "Production API destination", !!production.destination, production.destination ?? "", "Configure the confirmed HTTPS production API URL.");
  configured("institution", connection, "Institution code", !!production.institutionCode, `Institution ${production.institutionCode}; token association is not verified.`, "Configure the production institution code supplied by Recova.");
  configured("token", connection, "Production bearer token", production.tokenConfigured, "A token is stored on the API server. Its validity is not established by this check.", "Save a separate production bearer token on the API server.");
  configured("lookups", connection, "Production lookups enabled", production.enabled, "Read-only consent and mandate lookups are enabled.", "Enable production lookups on the API server.");
  add("provider-connection", connection, "Successful Recova record lookup", "unverified", "No successful provider lookup is certified by this configuration report. A 404 does not verify the token.", "Use an existing production loan reference below; confirm the returned institution and record with Recova.", "Farmer Market + Recova");

  const customer = "Customer authorization";
  let bvnKeyConfigured = false;
  try { bvnKeyConfigured = hasEncryptionKey(BVN_KEY_VAR); } catch { /* malformed key is not configured */ }
  configured("bvn-encryption", customer, "Verified BVN encryption key", bvnKeyConfigured, "A valid BVN encryption key is present. Compatibility with each saved BVN still needs a customer setup test.", "Configure the existing BVN encryption key used for customer records; do not replace it with an unrelated key.");
  configured("draft", customer, "Encrypted repayment drafts", setup.draftAvailable, "Repayment draft encryption is configured. Customer-specific eligibility is checked on the order.", "Configure a valid repayment data encryption key on the API server.");
  add("customer-eligibility", customer, "Eligible customer and repayment schedule", "unverified", "Readiness depends on each customer: verified BVN, approved financed order, bank account, repayment schedule and customer consent.", "Open the customer's approved order and complete repayment setup. This report does not inspect personal records.", "Customer + Farmer Market operations");
  configured("purpose", customer, "Mandate purpose", ["Collection", "Recovery"].includes(process.env.RECOVA_CONSENT_PURPOSE ?? ""), `Configured purpose: ${setup.purpose}.`, "Confirm the purpose with Recova, then configure Collection or Recovery.");
  configured("tenure", customer, "Loan tenure units", ["months", "days"].includes(process.env.RECOVA_TENURE_UNIT ?? ""), `Configured units: ${setup.tenureUnit}.`, "Confirm with Recova whether tenure is in months or days, then save that setting.");
  configured("contract", customer, "Provider behavior confirmation recorded", process.env.RECOVA_CONTRACT_CONFIRMED === "true", "The server records that production behavior was confirmed; this does not prove a live test.", "Confirm consent, collection and recovery behavior with Recova before recording confirmation.");
  add("consent", customer, "Live authorization requests", setup.submissionEnabled ? "configured" : "blocked", setup.submissionEnabled ? "Server prerequisites permit consent submission. No request is sent by this check." : setup.issues.join(" "), "Resolve the listed setup issues, then test one consent request with a consenting account holder.", "Farmer Market + Recova");
  add("mandate", customer, "Customer authorization and active mandate", "unverified", "A saved draft or an SMS does not establish an active mandate.", "Have the customer approve the genuine Recova link; refresh their mandate and confirm matching reference, customer, purpose and active status.", "Customer + Recova");

  const messaging = "SMS and webhook updates";
  const smsProvider = process.env.SMS_PROVIDER?.trim() || "termii";
  const bulk = smsProvider === "bulksmsnigeria";
  const smsToken = process.env.BULKSMSNIGERIA_API_TOKEN?.trim();
  const smsConfigured = bulk
    ? !!smsToken && !/\s/.test(smsToken) && /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,10}$/.test(process.env.BULKSMSNIGERIA_SENDER_ID?.trim() ?? "")
    : smsProvider === "termii" && !!process.env.TERMII_API_KEY;
  configured("sms-config", messaging, "SMS provider credentials", smsConfigured, `Provider: ${smsProvider}. Credentials are present; provider approval and delivery are separate checks.`, "Configure a live SMS provider token and valid sender name on the hosted API.");
  add("sms-delivery", messaging, "SMS delivery and authorization link", "unverified", "This report does not query delivery receipts or certify previous handset delivery. It sends no SMS.", "Confirm sender approval with the SMS provider and test a genuine Recova authorization message after callbacks are configured.", "Farmer Market + SMS provider");
  configured("webhook-secret", messaging, "Webhook authentication secret", (process.env.RECOVA_WEBHOOK_SECRET?.length ?? 0) >= 32, "A shared secret is configured; it is never displayed here.", "Configure a webhook secret of at least 32 characters and exchange it privately with Recova.");
  configured("webhook-switch", messaging, "Webhook processing enabled", process.env.RECOVA_WEBHOOKS_ENABLED === "true", "Callback processing is enabled on this server. Provider registration remains unverified.", "Agree callback authentication and register the URLs with Recova before enabling processing.");
  add("webhook-provider", messaging, "Recova webhook registration and delivery", "unverified", "Server settings cannot establish that Recova registered the URLs or supports our proposed x-recova-webhook-secret header.", "Ask Recova to confirm both callback URLs and authentication; then verify a genuine SMS callback and mandate-created callback.", "Recova + Farmer Market");

  const money = "Collection, recovery and repayment records";
  configured("duplicate-debit", money, "Mono automatic debit disabled", process.env.AUTO_DEBIT_ENABLED !== "true", "Mono automatic debit is disabled, avoiding a competing automatic repayment path.", "Disable Mono automatic debit before enabling Recova authorization.");
  add("collection", money, "Scheduled collection end-to-end", "unverified", "The configuration check does not prove scheduled debit execution, successful settlement or a matching repayment record.", "Confirm scheduling ownership, retry rules and payment-result notification format with Recova; complete a controlled collection test and verify the ledger.", "Recova + Farmer Market");
  add("recovery", money, "Recovery execution and collection transition", "blocked", "The repayment policy preview does not execute recovery. A production recovery transition is not enabled by this integration.", "Confirm the supported recovery operation, maturity trigger and duplicate-debit safeguards; implement and test the production transition before launch.", "Farmer Market + Recova");
  add("reconciliation", money, "Settlement, partial payments and voluntary repayments", "blocked", "The current Recova callbacks handle SMS and mandate creation; they do not post collection or recovery payments to the repayment ledger.", "Agree the payment-result or statement reconciliation contract, implement idempotent ledger posting and reconcile external payments before further debits.", "Farmer Market finance + technical team + Recova");
  add("pilot", money, "Controlled production pilot and sign-off", "blocked", "Full collection and recovery readiness has not been established.", "After the checks above are completed, test an agreed small amount with a consenting account holder; verify authorization, settlement, reconciliation and closure before launch.", "Farmer Market operations + Recova");
  return {
    checkedAt: new Date().toISOString(), scope: "configuration" as const,
    fullyOperational: false,
    summary: "Configuration checks do not verify money movement. Complete provider confirmation, production recovery and payment reconciliation before full launch.",
    checks,
    webhooks: [
      { title: "SMS webhook", path: "/v1/webhooks/recova/sms" },
      { title: "Mandate-created webhook", path: "/v1/webhooks/recova/mandate-created" },
    ],
  };
}
