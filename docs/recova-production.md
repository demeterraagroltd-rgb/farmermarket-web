# Recova production connection

The production lookup panel supports read-only consent and mandate lookups.
Customer order pages also support encrypted setup drafts and separately gated
consent submission. Live consent submission is disabled by default. Approving
a Collection mandate may authorize scheduled debits at Recova: do not enable
submission before the provider contract and pilot are agreed. This code does
not book collection/recovery payments, initiate sweeps, cancel live mandates,
automatically switch mandate purposes or disburse funds.

## Required provider details

Get the complete production API base URL from Recova. Do not derive it by
removing `staging` from the old URL. The connector currently accepts HTTPS on
recova.ng or its subdomains, excluding staging/sandbox/test hosts. If Recova
provides another domain, confirm it before updating the allowlist.

Use a separate production bearer token, generated/issued for the production
institution. Do not copy the staging token or assume the institution code stays
the same. Confirm the registered institution belongs to Farmer Market.

## Server environment

Set these on the API server (apps/api/.env for local work, hosting dashboard
environment variables for a deployed API). Never use NEXT_PUBLIC variables.

```dotenv
RECOVA_PRODUCTION_ENABLED=true
RECOVA_PRODUCTION_BASE_URL=https://recova.ng/recova_ofi_handshake/api
RECOVA_PRODUCTION_API_TOKEN=
RECOVA_PRODUCTION_INSTITUTION_CODE=223
```

Enter the provider-confirmed full base URL and bare production token. Set
RECOVA_PRODUCTION_ENABLED=true when the values are ready for a read-only check,
then restart the API. This flag enables lookups only, not debits.

Open `/dashboard/recova`, check production configuration, then retrieve a consent
or mandate using an agreed production loan reference. An HTTP 404 can mean a
missing record or route; it does not prove authentication. HTTP success alone
does not prove the mandate is active. Inspect the provider's business response.

Routes are admin/super-admin only, with staff authentication:

- GET /v1/admin/recova/production/status
- GET /v1/admin/recova/production/consent/:reference
- GET /v1/admin/recova/production/mandate/:reference

No POST endpoints exist in the staff lookup namespace. Production requests never use the
staging credentials, follow redirects or retry a mutation. Identity fields are
masked in returned production records; secrets are redacted. Results are not
cached or written to customer repayment records.

Provider update (23 October 2026): production host is recova.ng and institution
code is 223. The documented API path at this host returned HTTP 401 to an
unauthenticated lookup. This verifies reachability, not credentials, the exact
route contract or a functioning mandate. Production token verification remains
pending. An authenticated lookup with a synthetic reference subsequently returned
HTTP 404; this does not distinguish a missing record from an incorrect route.
The local API now enables production read-only lookups using the saved production
token. Deployment environment variables must be configured separately.
The institution code in configuration is metadata, not evidence that
the token belongs to that institution.

## Webhook handoff

Implemented routes (not deployed or registered with Recova):

- POST /v1/webhooks/recova/sms
- POST /v1/webhooks/recova/mandate-created

The public provider guide documents SMS fields phoneNumber, message,
institutionCode and loanReference. Its MandateCreation callback has only
institutionCode and loanReference and says it reports mandate creation. Confirm
whether the onboarding team's "Disbursement Webhook" refers to this event.
Neither handler disburses funds or approves an order.

Both routes reject requests until RECOVA_WEBHOOKS_ENABLED=true and a secret of
at least 32 characters is configured. The proposed authentication header is
x-recova-webhook-secret. The public guide specifies no authentication: **Recova
must explicitly agree to this header or an alternative must be implemented**.
Do not enable unauthenticated callbacks or register localhost/Mono URLs.

SMS is accepted only for an existing submitted loan of institution 223, with a
recipient matching its customer. The existing SMS sender must be live. Message
hashes deduplicate retries without storing raw messages. An uncertain SMS send
requires staff review; it is not automatically retried. No fake sender logs
customer links. Customers can also open the consent link in their account.
Mandate callbacks re-query Recova: only a matching reference, customerID,
repaymentType and explicit Active status can activate local mandate tracking.

## Customer setup

Apply migration 0026_recova_consent, build the DB package and API, then restart
the API. Preserve RECOVA_DATA_ENCRYPTION_KEY (base64 32-byte key) securely: losing
or rotating it makes saved setup details and consent links unreadable.

Customer path: Account → Orders → approved order → Set up repayment with Recova.
The customer enters their account number and 3-digit bank CBN code, confirms
ownership and data sharing, and enters their transaction PIN. The server loads
their verified BVN/contact details and the approved order's repayment schedule.
Only new financed orders with future unpaid installments are eligible; existing
partly repaid or overdue loans require separate reconciliation/onboarding.
A live or pending Mono mandate blocks Recova setup.

Preparation saves an encrypted draft and makes no provider request. The loan
reference is stable: fm-live-<order UUID>. Full BVNs/accounts and consent links
are encrypted at rest; customer responses include only the account's last four
digits, schedule and their own validated HTTPS provider link. No user ID,
amount, loan reference, repayment purpose or schedule comes from the browser.

The separate Submit action verifies the transaction PIN again, checks the
schedule has not changed, durably records submission intent, and sends one
CreateConsentRequest POST. Ambiguous outcomes become needs_review and are
never automatically resubmitted, even after a process restart. Refreshing status
uses GET lookups and may recover the original link. Unknown provider statuses
do not confirm activation. Active means mandate active, not money received.

Additional environment settings (live defaults remain off):

```dotenv
RECOVA_DATA_ENCRYPTION_KEY=
RECOVA_CONSENT_ENABLED=false
RECOVA_CONTRACT_CONFIRMED=false
RECOVA_CONSENT_PURPOSE=
RECOVA_TENURE_UNIT=
RECOVA_WEBHOOKS_ENABLED=false
RECOVA_WEBHOOK_SECRET=
```

Before enabling: confirm Collection versus Recovery, loanTenure units (months
or days), the full production endpoint and consent-link host, institution legal
name, callback security, actual status strings, provider customerID semantics,
payment notifications and reconciliation, and the controlled pilot account.
RECOVA_CONTRACT_CONFIRMED must only be true after this handoff is complete.
RECOVA_CONSENT_ENABLED enables potentially financially consequential consent;
it is independent of the read-only lookup flag. AUTO_DEBIT_ENABLED must be false.
Mono mandate creation is also blocked while Recova consent is enabled or that
customer has a submitted/pending/active/unconfirmed Recova setup.

Provider source: [Recova direct debit documentation](https://documenter.getpostman.com/view/43716434/2sB2cShj2g), checked 24 October 2026.

## Before financial activation

Agree callback authentication and payloads, recovery/collection transition and
sweep configuration, settlement and fee handling, consent scope, and the pilot
amount/account. Implement durable provider events, idempotent repayment posting,
manual payment reconciliation and reversal handling before unattended processing.
The production institution-created email alone does not verify these settings.
