# SMS provider configuration

`SMS_PROVIDER=termii` preserves the existing delivery path (and remains the
default when unset). `SMS_PROVIDER=bulksmsnigeria` selects the new adapter for
all SMS consumers: signup OTPs and authenticated Recova SMS callbacks.

Configure only on the API, never in NEXT_PUBLIC variables:

```dotenv
SMS_PROVIDER=bulksmsnigeria
BULKSMSNIGERIA_API_TOKEN=
BULKSMSNIGERIA_SENDER_ID=
```

Copy the bare API token from the provider account. Sender ID must be the exact
approved name and at most 11 characters (for example, FarmerMkt). An example is
not an approval: register it with BulkSMSNigeria first. Explicit provider
selection with incomplete configuration stops API startup; there is no silent
fallback to another provider or a fake sender.

The adapter uses fixed HTTPS `POST /api/v2/sms`, bearer authentication and the
corporate transactional route. It sends one normalized Nigerian recipient at a
time, with a 20-second timeout and no redirects or automatic retries. Explicit
success, a message ID, one accepted recipient and an appropriate transactional
route are required. The documented direct-refund fallback is also accepted
when the response identifies the requested corporate route and supplies its
route notice: the provider already accepted the message, so it must not be
retried as a failure. Provider acceptance is not proof of handset delivery.
Unrecognized routing or ambiguous sends require checking provider
records before resending. No provider response, token, recipient or message is
logged by this adapter.

Set the same settings in Render before deploying/activating this provider.
Token verification can use a read-only balance/account request. Sending an
actual test SMS requires an agreed recipient; no message is sent just by
saving configuration, building, starting the API or running mocked tests.
Recova callback authentication/registration remains a separate setup step.

Source checked 25 October 2026: https://www.bulksmsnigeria.com/api
