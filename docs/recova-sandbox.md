# Recova sandbox pilot

## Guided practice journey

The top of `/dashboard/recova` now offers a complete practice journey. Start a
test case, advance individual steps, or run all remaining steps. It exercises
the real ApplicationsService, OrdersService (including checkout and inventory),
WalletService and LedgerService against a temporary PGlite database with the
project's actual migrations. The shared application DB provider is never passed
to the runner. No practice records are inserted into live customer/order queues.

The fixture is a N60,000 food basket. Existing checkout rules add N500 delivery
and N1,800 service charge, so the total is N62,300. A zero-interest three-month
test plan produces three installments with final-installment rounding. This is
a test fixture, not a change to Farmer Market's published plan pricing.

Phone/PIN/KYC verification, notification delivery, bank mandate authorisation,
collection and recovery outcomes use explicit test adapters. No provider calls
are made by the journey. It demonstrates a first collection, failed second
collection, maturity, N10,000 partial recovery and final recovery. Simulated
receipts are applied using the real repayment/ledger transaction. Duplicate
synthetic delivery is checked before another posting can occur.

Practice state exists only in this API process; restarting clears it. Access is
admin/super-admin only, requires the existing sandbox flag and is refused in
production. One staff-owned practice database may run on a local API at a time.
This is workflow/integration practice, not proof that Recova debited a bank.

To run it without a staff browser session, build `apps/api`, then run
`node scripts/run-recova-practice.cjs` from the repository root. This script does
not load .env or connect to the shared DB. It saves a timestamped Markdown
report and JSON snapshot in `output/`, then disposes of its temporary database.

Validation: the complete SQL-backed journey passed, along with the sandbox
tests and 11 existing order/inventory regressions (29 tests total). The API
build and web type check passed. A standalone run recorded N62,300 in simulated
repayments, zero remaining debt, restored test credit and a balanced ledger.

Routes: GET `.../journey`, POST `.../journey/start`, POST `.../journey/next`,
POST `.../journey/run`, under `/v1/admin/recova/sandbox`.

Open `/dashboard/recova` while signed in as an admin or super admin. Run the
API from `apps/api` (the normal `pnpm dev:api` command does this) so dotenv
loads `apps/api/.env`. Set `RECOVA_SANDBOX_ENABLED=true` and
`RECOVA_API_TOKEN=<bare token>` there, then restart the API. Do not put the
provider token in web environment variables. A deployed API needs its own
server environment settings; a local .env does not configure Render.

## Starting business policy

- One scenario represents one financing agreement and its complete schedule.
- The three-month example has three payments of N22,000 (N66,000 total) against
  N60,000 principal. The difference is already included in the scheduled total.
- During the tenor, collect unpaid amounts whose due dates have arrived,
  including earlier missed installments. Future installments are excluded.
- Recovery becomes eligible at midnight in Nigeria after the final scheduled
  due date, plus configurable grace days (zero by default). Derive maturity from
  the actual schedule, not a fixed 90-day duration.
- After maturity the recovery target is the remaining unpaid scheduled balance.
- Additional default interest, recovery fees passed to borrowers, and penalties
  are zero until their rates, basis and permission are settled. Do not implement
  the email's interest-only formula as a total debt calculation.
- An unreconciled voluntary payment or unresolved debit holds either target.
- Fully paid agreements close. There are no future installments to resume after
  maturity unless the agreement has been restructured.

This policy is an isolated preview, not the existing Mono scheduler's policy.
No customer loan records, repayments, Mono mandates, or bank balances are changed.
Recovery eligibility is calculated automatically; no recovery request is sent.

## Test sequence

1. Check configuration. This checks presence of configuration, not authentication.
2. Preview the example on 22 December 2026: N22,000 is due; N22,000 is future.
3. Preview it after 21 January 2027 ends in Nigeria: N44,000 is recovery eligible.
4. Enter a partial payment in the Paid (naira) column and preview again; the target must fall.
5. Mark a voluntary payment pending reconciliation: both targets must be zero.
6. Generate a reference beginning `fm-sandbox-`. Use provider-supplied test
   BVN/account/phone/email details only. Reset payments to zero and use
   future dates. Confirm the provider's loanTenure units before submission.
7. Create staging consent. This invokes the documented consent endpoint and may
   cause an SMS through the provider's configured SMS callback. It does not
   establish an active mandate. Follow the returned consent approval instructions
   using the test customer, then retrieve consent and mandate state.
8. If submission times out, retrieve the same reference. Never automatically
   resend a consent POST. The API records an intent in audit_logs before sending
   and refuses another submission under that reference, across replicas.

The schedule and customer fixture are browser memory only. Save your test
reference separately if needed; use lookup after returning to the page.

## API routes (staff JWT required; admin/super_admin only)

- `GET /v1/admin/recova/sandbox/status`
- `POST /v1/admin/recova/sandbox/preview`
- `POST /v1/admin/recova/sandbox/consent`
- `GET /v1/admin/recova/sandbox/consent/:reference`
- `GET /v1/admin/recova/sandbox/mandate/:reference`

Preview inputs use integer kobo and YYYY-MM-DD installment dates. Scenario time
is an ISO timestamp with timezone. Conversion to naira occurs only at the
Recova transport boundary. All provider operations use the hard-coded staging
origin, reject redirects, time out after 25 seconds and never retry a POST.
The API returns the provider HTTP status separately from its own HTTP status;
`ok` denotes HTTP success only, not business acceptance or token validation.

## Before enabling real repayment processing

Confirm the Collection-to-Recovery transition, reactive sweep URL and payload,
institution sweep configuration, tenure units, callback authentication, delivery
retries, unique transaction references, partial settlement and reversal semantics.
Register SMS and mandate callbacks with Recova and agree the loan-balance update
contract. They are not exposed as unauthenticated endpoints in this pilot.

Then implement provider-specific persisted loan mandates, authenticated durable
callback processing, repayment allocation, manual-payment reconciliation and
settlement accounting. Reconcile pending payments before sweeps; weekly manual
reconciliation alone is insufficient for unattended recovery.

Only then connect the approved policy to a durable scheduler, coordinate it with
the existing Mono collection path, and run production acceptance testing. The
sandbox module never replaces or enables the Mono scheduler.

Source: https://documenter.getpostman.com/view/43716434/2sB2cShj2g

## Pilot validation (21 October 2026)

- API and web TypeScript checks passed.
- Browser checks using the existing staff session confirmed configuration,
  N22,000 collection during the tenor, N44,000 recovery eligibility after maturity,
  and a zero target while a voluntary payment awaits reconciliation.
- The mandate lookup reached staging and returned HTTP 404 with an
  institution-specific no-mandate-found message for the synthetic reference
  `fm-sandbox-connectivity-check`. This is not a successful mandate lookup.
- The provider message identifies the institution as `Demeterra Agro Ltd`.
  Confirm that this is Farmer Market's intended registered staging profile
  before sending any customer data.
- No consent was created: approved sandbox identity/bank fixtures and confirmation
  of provider tenure units are still needed. No sweep or repayment posting ran.

## Review against the Recova API collection (21 October 2026)

Status: on track with the agreed rollout (staging connection → consent and
mandate tracking → reconciliation → staff-controlled recovery). Step 1 is done;
step 2 is blocked on Recova, not on code.

Findings from the documentation:

- **Reactive sweep is not documented.** The collection says reactive sweeps need
  institution profiling but publishes no endpoint. The recommended first release
  (Farmer Market decides when to recover) depends on Recova supplying it.
- **Consent depends on callbacks we do not expose.** Recova sends the consent SMS
  by POSTing to *our* SmsAlert endpoint and reports activation through MandateCreation.
  Neither is registered, so no SMS is sent. For sandbox tests, open the
  `consentApprovalUrl` from the create/retrieve response (the page now links it).
- **BVNInquiry targets core banking.** For retail loans Recova validates the BVN
  and account against the lender's core-banking endpoint. Farmer Market has none,
  so Recova must confirm how BVN validation works on the OFI handshake profile.
- **A Collection mandate debits automatically on schedule dates.** Use Recovery
  for tests (now the page default) and cancel test mandates after each run (new
  "Cancel test mandate" button).
- **Mandate responses return `customerID` as a number** but consent takes a string.
  Use digits for the test customer ID until Recova clarifies.

Adjustments made:

- Schedule dates are sent as midday WAT (`T12:00:00+01:00`) rather than midnight,
  which is 23:00Z the previous day and could make a UTC-based debit run a day early.
- Added `POST consent/:reference/resend` and `POST mandate/:reference/cancel`
  (staging only, audited, never retried).

## Questions to send Recova (lend@appzonegroup.com / recovasupport@appzonegroup.com)

1. Is "Demeterra Agro Ltd" (institution 167) the correct staging profile for Farmer Market?
2. Please supply sandbox test BVN, phone, bank CBN code and account details that complete consent.
3. What unit is `loanTenure` (days or months)? Should `linkedAccountNumber` equal the preferred repayment account?
4. Without a core banking system, how is BVN/account validation (BVNInquiry) handled for us?
5. Can staging send the consent SMS itself, or must we host the SmsAlert callback? How are callbacks authenticated and retried?
6. Please enable reactive sweep for us and share its endpoint, payload, status lookup and duplicate-request behaviour.
7. Is a Recovery-type mandate inactive until we trigger a sweep? Does it need `collectionPaymentSchedules`?
8. How does a Collection mandate move into Recovery? (Only SwitchRecoveryToCollection is documented.)
9. Which LoanBalanceUpdate variant applies to us (non-deposit-money)? Is `transactionReference` unique per debit? How are partial recoveries, reversals (ReverseFunds) and fees settled?
10. Which banks participate in BVN-wide recovery?
