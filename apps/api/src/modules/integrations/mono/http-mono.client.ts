import { BadRequestException, Logger } from "@nestjs/common";
import type {
  MonoAccountDetails,
  MonoClient,
  MonoIncome,
  MonoTransaction,
} from "./mono.types";

const DEFAULT_BASE_URL = "https://api.withmono.com";

// Mono wraps most responses as { status, message, data }, but a few (the
// token exchange) return the object flat. `unwrap` copes with both.
function unwrap<T>(body: unknown): T {
  if (body && typeof body === "object" && "data" in body && (body as { data: unknown }).data != null) {
    return (body as { data: T }).data;
  }
  return body as T;
}

function toKobo(naira: unknown): number | null {
  const n = typeof naira === "string" ? Number(naira) : (naira as number);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

export class HttpMonoClient implements MonoClient {
  readonly live = true;
  private readonly log = new Logger("MonoClient");
  private readonly baseUrl: string;

  constructor(
    private readonly secretKey: string,
    baseUrl?: string,
  ) {
    this.baseUrl = (baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
  }

  private async call<T>(path: string, init: RequestInit = {}): Promise<T> {
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
    if (!res.ok || (body as { status?: string }).status === "failed") {
      const msg = (body as { message?: string }).message || raw.slice(0, 200) || `HTTP ${res.status}`;
      this.log.warn(`[mono] ${init.method ?? "GET"} ${path} → ${res.status}: ${msg}`);
      throw new BadRequestException(`Mono: ${msg}`);
    }
    return unwrap<T>(body);
  }

  async exchangeToken(code: string): Promise<{ accountId: string }> {
    const data = await this.call<{ id?: string }>("/v2/accounts/auth", {
      method: "POST",
      body: JSON.stringify({ code }),
    });
    if (!data?.id) throw new BadRequestException("Mono: no account id in the exchange response");
    return { accountId: data.id };
  }

  async getAccountDetails(accountId: string): Promise<MonoAccountDetails> {
    // GET /v2/accounts/:id → { account: {...}, meta: {...} }
    const data = await this.call<{
      account?: {
        name?: string;
        accountNumber?: string;
        currency?: string;
        balance?: number;
        bvn?: string;
        institution?: { name?: string };
      };
    }>(`/v2/accounts/${accountId}`);
    const a = data.account ?? {};
    return {
      accountId,
      name: a.name ?? null,
      accountNumberLast4: a.accountNumber ? a.accountNumber.slice(-4) : null,
      bvn: a.bvn ?? null,
      // Mono returns balance already in kobo for NGN accounts.
      balanceKobo: typeof a.balance === "number" ? Math.round(a.balance) : null,
      currency: a.currency ?? "NGN",
      institution: a.institution?.name ?? null,
    };
  }

  async getTransactions(accountId: string, months: number): Promise<MonoTransaction[]> {
    const start = new Date();
    start.setMonth(start.getMonth() - months);
    const qs = new URLSearchParams({
      paginate: "false",
      start: start.toISOString().slice(0, 10),
    });
    const data = await this.call<
      Array<{ amount?: number; type?: string; narration?: string; date?: string; balance?: number }>
    >(`/v2/accounts/${accountId}/transactions?${qs.toString()}`);
    const rows = Array.isArray(data) ? data : [];
    return rows.map((t) => ({
      amountKobo: typeof t.amount === "number" ? Math.round(t.amount) : 0,
      type: t.type === "credit" ? "credit" : "debit",
      narration: t.narration ?? "",
      date: t.date ?? "",
      balanceKobo: typeof t.balance === "number" ? Math.round(t.balance) : null,
    }));
  }

  async getIncome(accountId: string): Promise<MonoIncome | null> {
    try {
      const data = await this.call<{
        monthly_income?: number | string;
        average_income?: number | string;
        income_confidence?: string;
        last_income_description?: string;
      }>(`/v2/accounts/${accountId}/income`);
      if (!data || typeof data !== "object") return null;
      const conf = (data.income_confidence ?? "").toLowerCase();
      return {
        monthlyIncomeKobo: toKobo(data.monthly_income),
        averageIncomeKobo: toKobo(data.average_income),
        confidence: conf === "high" || conf === "medium" || conf === "low" ? (conf as "high" | "medium" | "low") : null,
        lastIncomeDescription: data.last_income_description ?? null,
      };
    } catch {
      // Product not enabled / no data — analysis falls back to transactions.
      return null;
    }
  }
}
