// Customer-side counterpart to lib/auth.ts (which is staff-only). Two callers,
// two token lifetimes:
//
//  * The /apply KYC wizard holds its token in component state and passes it
//    to `customerFetch` explicitly — it needs one before there's a session to
//    speak of, and it's mid-flow, not signed in.
//  * The account pages read a persisted session via `accountFetch`. The same
//    account and the same 6-digit login code work on the phone app; the API
//    issues a 30-day token to both, so signing in on one doesn't sign the
//    other out.
//
// localStorage, like the staff side — no refresh rotation yet. Both keys are
// namespaced apart so a staff member testing a buyer account on the same
// browser doesn't clobber their own dashboard session.

const BASE = process.env.NEXT_PUBLIC_API_URL;
const SESSION_KEY = "farmermarket_customer_session";

/** 'unverified' → 'submitted' → 'verified', with 'needs_more_info' as the loop back. */
export type VerificationStatus = "unverified" | "submitted" | "needs_more_info" | "verified";

export interface CustomerSession {
  token: string;
  userId: string;
  fullName: string;
  phone: string;
  verificationStatus: VerificationStatus;
  hasTxnPin: boolean;
}

export function getCustomerSession(): CustomerSession | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(SESSION_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as CustomerSession;
    return parsed?.token ? parsed : null;
  } catch {
    // A malformed blob is indistinguishable from no session; don't leave it
    // in place to fail again on the next read.
    window.localStorage.removeItem(SESSION_KEY);
    return null;
  }
}

export function saveCustomerSession(session: CustomerSession): void {
  window.localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  // Other tabs listen for this; `storage` doesn't fire in the tab that wrote.
  window.dispatchEvent(new Event("farmermarket:session"));
}

/** Merge in fields that changed — verification status after a submit, say. */
export function patchCustomerSession(patch: Partial<CustomerSession>): void {
  const current = getCustomerSession();
  if (!current) return;
  saveCustomerSession({ ...current, ...patch });
}

export function clearCustomerSession(): void {
  window.localStorage.removeItem(SESSION_KEY);
  window.dispatchEvent(new Event("farmermarket:session"));
}

export async function customerFetch(
  path: string,
  token: string | null,
  init: RequestInit = {},
): Promise<Response> {
  const headers = new Headers(init.headers);
  // Registration and sign-in are public — sending `Bearer ` with no token
  // reads as a malformed credential rather than as no credential.
  if (token) headers.set("Authorization", `Bearer ${token}`);
  // Let the browser set the multipart boundary for FormData bodies.
  if (!(init.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  return fetch(`${BASE}${path}`, { ...init, headers });
}

/**
 * A call made as the signed-in buyer. A 401 means the 30-day token expired
 * or was revoked, so the stored session is dropped — otherwise every
 * subsequent page would retry with a credential the API has already refused.
 */
export async function accountFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const session = getCustomerSession();
  const res = await customerFetch(path, session?.token ?? null, init);
  if (res.status === 401) clearCustomerSession();
  return res;
}

export async function readError(res: Response): Promise<string> {
  try {
    const body = await res.json();
    // The API's validation pipe sends every failure as one newline-separated
    // string here, each naming its field — render it with `whitespace-pre-line`.
    if (typeof body?.message === "string") return body.message;
    if (Array.isArray(body?.message)) return body.message.join("\n");
    if (body?.fieldErrors) {
      const all = Object.values(body.fieldErrors).flat();
      if (all.length > 0) return all.map(String).join("\n");
    }
  } catch {
    /* fall through */
  }
  return `Something went wrong (${res.status})`;
}
