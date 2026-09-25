import { BadRequestException, Logger } from "@nestjs/common";
import {
  DebitRateLimitedError,
  type CreateDebitCustomerInput,
  type DebitInput,
  type DebitResult,
  type DirectDebitClient,
  type InitiateMandateInput,
  type MandateInfo,
} from "./direct-debit.types";

const DEFAULT_BASE_URL = "https://api.withmono.com";

function unwrap<T>(body: unknown): T {
  if (body && typeof body === "object" && "data" in body && (body as { data: unknown }).data != null) {
    return (body as { data: T }).data;
  }
  return body as T;
}

const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);
const kobo = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? Math.round(v) : null);

export class HttpDirectDebitClient implements DirectDebitClient {
  readonly live = true;
  private readonly log = new Logger("DirectDebitClient");
  private readonly baseUrl: string;

  constructor(
    private readonly secretKey: string,
    baseUrl?: string,
  ) {
    this.baseUrl = (baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
  }

  private async call(path: string, init: RequestInit = {}): Promise<{ status: number; body: unknown }> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        "mono-sec-key": this.secretKey,
        accept: "application/json",
        "content-type": "application/json",
        ...init.headers,
      },
    });
    const raw = await res.text();
    let body: unknown = {};
    try {
      body = raw ? JSON.parse(raw) : {};
    } catch {
      /* non-JSON */
    }
    return { status: res.status, body };
  }

  /** Throws a message-bearing error for anything but a 2xx. Never logs the request body (it can hold a BVN). */
  private async ok(path: string, init: RequestInit = {}): Promise<unknown> {
    const { status, body } = await this.call(path, init);
    const failed = status < 200 || status >= 300 || (body as { status?: string })?.status === "failed";
    if (failed) {
      const msg = (body as { message?: string })?.message || `HTTP ${status}`;
      this.log.warn(`[mono-dd] ${init.method ?? "GET"} ${path} → ${status}: ${msg}`);
      throw new BadRequestException(`Mono: ${msg}`);
    }
    return body;
  }

  async createCustomer(input: CreateDebitCustomerInput) {
    const body = await this.ok("/v2/customers", {
      method: "POST",
      body: JSON.stringify({
        first_name: input.firstName,
        last_name: input.lastName,
        email: input.email,
        phone: input.phone,
        address: input.address,
        type: "individual",
        identity: { type: "bvn", number: input.bvn },
      }),
    });
    const id = str(unwrap<{ id?: string }>(body)?.id);
    if (!id) throw new BadRequestException("Mono: no customer id in the response");
    return { customerId: id };
  }

  async initiateMandate(input: InitiateMandateInput) {
    // No account_number/bank_code: the customer picks their bank on Mono's page,
    // so we never need (or store) a full account number.
    const body = await this.ok("/v2/payments/initiate", {
      method: "POST",
      body: JSON.stringify({
        amount: input.amountKobo,
        type: "recurring-debit",
        method: "mandate",
        mandate_type: "emandate",
        debit_type: "variable",
        description: input.description,
        reference: input.reference,
        redirect_url: input.redirectUrl,
        customer: { id: input.customerId },
        start_date: input.startDate,
        end_date: input.endDate,
      }),
    });
    const data = unwrap<{ mono_url?: string; mandate_id?: string; id?: string }>(body);
    const url = str(data?.mono_url);
    if (!url) throw new BadRequestException("Mono: no authorisation link in the response");
    return { authorisationUrl: url, mandateId: str(data?.mandate_id) ?? null };
  }

  async getMandate(mandateId: string): Promise<MandateInfo> {
    const data = unwrap<{ status?: string; ready_to_debit?: boolean }>(await this.ok(`/v3/payments/mandates/${encodeURIComponent(mandateId)}`));
    return { status: str(data?.status) ?? "unknown", readyToDebit: data?.ready_to_debit === true };
  }

  async cancelMandate(mandateId: string) {
    await this.ok(`/v3/payments/mandates/${encodeURIComponent(mandateId)}/cancel`, { method: "PATCH", body: "{}" });
  }

  async debit(mandateId: string, input: DebitInput): Promise<DebitResult> {
    const { status, body } = await this.call(`/v3/payments/mandates/${encodeURIComponent(mandateId)}/debit`, {
      method: "POST",
      body: JSON.stringify({ amount: input.amountKobo, reference: input.reference, narration: input.narration }),
    });
    if (status === 429) throw new DebitRateLimitedError((body as { message?: string })?.message);

    const data = unwrap<{
      status?: string;
      response_code?: string;
      message?: string;
      fee?: number;
      reference_number?: string;
      session_id?: string;
    }>(body);
    const code = str(data?.response_code);
    const message = str((body as { message?: string })?.message) ?? str(data?.message);
    const providerReference = str(data?.reference_number) ?? str(data?.session_id);

    if (status >= 200 && status < 300) {
      const s = (str(data?.status) ?? "").toLowerCase();
      // "00" is success; "99" (and anything pending) resolves later by webhook.
      const outcome = s === "successful" || code === "00" ? "successful" : s === "failed" ? "failed" : "processing";
      return { outcome, responseCode: code, message, feeKobo: kobo(data?.fee), providerReference };
    }
    // A non-2xx that isn't a rate limit is a refusal (mandate not ready, bad
    // amount, ...). The attempt is recorded as failed with Mono's reason.
    this.log.warn(`[mono-dd] debit ${mandateId} → ${status}: ${message ?? "no message"}`);
    return { outcome: "failed", responseCode: code, message: message ?? `HTTP ${status}`, feeKobo: null, providerReference };
  }
}
