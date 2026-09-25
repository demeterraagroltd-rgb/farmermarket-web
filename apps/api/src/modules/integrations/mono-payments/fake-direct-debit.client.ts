import { Logger } from "@nestjs/common";
import type {
  CreateDebitCustomerInput,
  DebitInput,
  DebitResult,
  DirectDebitClient,
  InitiateMandateInput,
  MandateInfo,
} from "./direct-debit.types";

// Module-level so two fake clients never hand out the same id, as Mono never would.
let fakeCustomerSeq = 0;

/**
 * Used when no Mono payments key is configured. Never moves money: a debit is
 * accepted as "processing" and stays that way until a test (or a developer
 * posting a webhook by hand) settles it. Records what it was asked so tests can
 * assert on it, and can be told to fail the next debit.
 */
export class FakeDirectDebitClient implements DirectDebitClient {
  readonly live = false;
  private readonly log = new Logger("FakeDirectDebitClient");

  readonly debits: Array<{ mandateId: string; input: DebitInput }> = [];
  readonly cancelled: string[] = [];
  private nextDebit: DebitResult | Error | null = null;

  /** The next debit() returns (or throws) this instead of the default "processing". */
  failNextDebitWith(result: DebitResult | Error) {
    this.nextDebit = result;
  }

  async createCustomer(input: CreateDebitCustomerInput) {
    this.log.log(`[mono-dd:fake] createCustomer(${input.email})`);
    return { customerId: `cus_fake_${++fakeCustomerSeq}` };
  }

  async initiateMandate(input: InitiateMandateInput) {
    this.log.log(`[mono-dd:fake] initiateMandate(${input.reference}, ₦${input.amountKobo / 100})`);
    return { authorisationUrl: `https://fake.mono.test/authorise/${input.reference}`, mandateId: null };
  }

  async getMandate(): Promise<MandateInfo> {
    return { status: "approved", readyToDebit: true };
  }

  async cancelMandate(mandateId: string) {
    this.cancelled.push(mandateId);
  }

  async debit(mandateId: string, input: DebitInput): Promise<DebitResult> {
    this.log.log(`[mono-dd:fake] debit(${mandateId}, ₦${input.amountKobo / 100}, ${input.reference})`);
    this.debits.push({ mandateId, input });
    if (this.nextDebit) {
      const next = this.nextDebit;
      this.nextDebit = null;
      if (next instanceof Error) throw next;
      return next;
    }
    return { outcome: "processing", responseCode: "99", message: "pending", feeKobo: null, providerReference: `fake_ref_${input.reference}` };
  }
}
