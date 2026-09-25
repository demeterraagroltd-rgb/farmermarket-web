// Mono Direct Debit (bank mandates) — the rail auto-debit collects through.
// Behind an interface with a fake, like every other integration here. Base URL
// https://api.withmono.com, auth via `mono-sec-key`. Amounts are kobo throughout.
//
// Verified against Mono's docs (docs.mono.co/docs/payments/direct-debit):
//   POST /v2/customers                       create the customer (BVN identity)
//   POST /v2/payments/initiate               start a mandate → a link for the customer
//   GET  /v3/payments/mandates/{id}          read a mandate
//   PATCH /v3/payments/mandates/{id}/cancel  cancel it
//   POST /v3/payments/mandates/{id}/debit    take money (variable mandates)
// Not verified from the docs (handled defensively in the HTTP client): the exact
// response field that carries the mandate id on initiate.

export const DIRECT_DEBIT_CLIENT = Symbol("DIRECT_DEBIT_CLIENT");

export interface CreateDebitCustomerInput {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  address: string;
  bvn: string;
}

export interface InitiateMandateInput {
  customerId: string;
  /** The most we may collect over the mandate's life. */
  amountKobo: number;
  /** Our unique reference; Mono echoes it on the mandate webhooks. */
  reference: string;
  description: string;
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  redirectUrl: string;
}

export interface DebitInput {
  amountKobo: number;
  /** Unique per attempt — Mono rejects a reused one, which is what makes a retry of the same attempt safe. */
  reference: string;
  narration: string;
}

export type DebitOutcome = "successful" | "processing" | "failed";

export interface DebitResult {
  outcome: DebitOutcome;
  /** "00" ok, "99" processing, "51" insufficient funds, ... (NIBSS response codes). */
  responseCode: string | null;
  message: string | null;
  feeKobo: number | null;
  /** Mono's reference/session for the debit, for matching its later webhook. */
  providerReference: string | null;
}

/** Mono refused the debit because we've made too many attempts today (HTTP 429). Not a failure of the customer's account. */
export class DebitRateLimitedError extends Error {
  constructor(message = "Mono is rate-limiting debits for this account today") {
    super(message);
    this.name = "DebitRateLimitedError";
  }
}

export interface MandateInfo {
  status: string;
  readyToDebit: boolean;
}

export interface DirectDebitClient {
  /** True for the real client — the fake reports false. Auto-debit refuses to run against a fake in production. */
  readonly live: boolean;
  createCustomer(input: CreateDebitCustomerInput): Promise<{ customerId: string }>;
  initiateMandate(input: InitiateMandateInput): Promise<{ authorisationUrl: string; mandateId: string | null }>;
  getMandate(mandateId: string): Promise<MandateInfo>;
  cancelMandate(mandateId: string): Promise<void>;
  debit(mandateId: string, input: DebitInput): Promise<DebitResult>;
}
