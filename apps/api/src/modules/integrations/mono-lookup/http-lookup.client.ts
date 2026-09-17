import { BadRequestException, Logger } from "@nestjs/common";
import type {
  BvnOtpMethod,
  BvnSession,
  IdentityRecord,
  LookupClient,
} from "./lookup.types";

const DEFAULT_BASE_URL = "https://api.withmono.com";

// Mono wraps most responses as { status, message, data }, but not all of
// them. Same coping strategy as HttpMonoClient.
function unwrap<T>(body: unknown): T {
  if (body && typeof body === "object" && "data" in body && (body as { data: unknown }).data != null) {
    return (body as { data: T }).data;
  }
  return body as T;
}

function str(v: unknown): string | null {
  if (typeof v === "number") return String(v);
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

/**
 * Government records spell dates every which way — "1990-04-28",
 * "28-04-1990", "28/04/1990". Normalise to ISO where the ordering is
 * unambiguous, otherwise hand back the raw string rather than invent a date;
 * the comparison treats an unparseable DOB as "couldn't check", not "wrong".
 */
function normaliseDob(raw: unknown): string | null {
  const s = str(raw);
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (m) {
    const [, a, b, y] = m;
    const day = Number(a);
    const month = Number(b);
    // Only safe when the first field can't be a month.
    if (day > 12 && month >= 1 && month <= 12) {
      return `${y}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
    if (day <= 12 && month <= 12) return s; // genuinely ambiguous — don't guess
  }
  const t = Date.parse(s);
  return Number.isFinite(t) ? new Date(t).toISOString().slice(0, 10) : s;
}

export class HttpLookupClient implements LookupClient {
  readonly live = true;
  private readonly log = new Logger("LookupClient");
  private readonly baseUrl: string;

  constructor(
    private readonly secretKey: string,
    baseUrl?: string,
  ) {
    this.baseUrl = (baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
  }

  private async call<T>(path: string, body: unknown, sessionId?: string): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: {
        "mono-sec-key": this.secretKey,
        accept: "application/json",
        "content-type": "application/json",
        ...(sessionId ? { "x-session-id": sessionId } : {}),
      },
      body: JSON.stringify(body ?? {}),
    });
    const raw = await res.text();
    let parsed: unknown = {};
    try {
      parsed = raw ? JSON.parse(raw) : {};
    } catch {
      /* non-JSON */
    }
    if (!res.ok || (parsed as { status?: string }).status === "failed") {
      const msg =
        (parsed as { message?: string }).message || raw.slice(0, 200) || `HTTP ${res.status}`;
      // Never log the request body — it carries a BVN/NIN.
      this.log.warn(`[lookup] POST ${path} → ${res.status}: ${msg}`);
      throw new BadRequestException(`Mono Lookup: ${msg}`);
    }
    return unwrap<T>(parsed);
  }

  async initiateBvn(bvn: string): Promise<BvnSession> {
    const data = await this.call<{
      session_id?: string;
      sessionId?: string;
      methods?: Array<{ method?: string; hint?: string }>;
    }>("/v2/lookup/bvn/initiate", { bvn, scope: "identity" });

    const sessionId = str(data?.session_id) ?? str(data?.sessionId);
    if (!sessionId) throw new BadRequestException("Mono Lookup: no session id in the initiate response");

    const methods: BvnOtpMethod[] = (data.methods ?? [])
      .map((m) => ({ method: str(m?.method) ?? "", hint: str(m?.hint) }))
      .filter((m) => m.method);
    if (!methods.length) {
      throw new BadRequestException(
        "Mono Lookup: NIBSS has no contact details on file for that BVN, so consent can't be requested.",
      );
    }
    return { sessionId, methods };
  }

  async sendBvnOtp(sessionId: string, method: string, phoneNumber?: string): Promise<void> {
    await this.call<unknown>(
      "/v2/lookup/bvn/verify",
      phoneNumber ? { method, phone_number: phoneNumber } : { method },
      sessionId,
    );
  }

  async fetchBvn(sessionId: string, otp: string): Promise<IdentityRecord> {
    const data = await this.call<Record<string, unknown>>(
      "/v2/lookup/bvn/details",
      { otp },
      sessionId,
    );
    return this.toRecord(data, "bvn");
  }

  async lookupNin(nin: string): Promise<IdentityRecord> {
    const data = await this.call<Record<string, unknown>>("/v3/lookup/nin", { nin });
    return this.toRecord(data, "nin");
  }

  /**
   * Both products return the same person in slightly different clothes
   * (`first_name` vs `firstName`, `dob` vs `date_of_birth`), so read every
   * spelling. Deliberately drops everything else Mono sends — the base64
   * photo especially, which has no place in a JSONB review column.
   */
  private toRecord(d: Record<string, unknown>, source: "bvn" | "nin"): IdentityRecord {
    const pick = (...keys: string[]): string | null => {
      for (const k of keys) {
        const v = str(d[k]);
        if (v) return v;
      }
      return null;
    };
    return {
      source,
      firstName: pick("first_name", "firstName", "firstname"),
      lastName: pick("last_name", "lastName", "surname", "lastname"),
      middleName: pick("middle_name", "middleName", "middlename"),
      dateOfBirth: normaliseDob(d.date_of_birth ?? d.dateOfBirth ?? d.dob ?? d.birthdate),
      gender: pick("gender", "sex"),
      phone: pick("phone_number", "phoneNumber", "phone", "mobile", "telephoneno"),
      nin: pick("nin", "nin_number"),
    };
  }
}
