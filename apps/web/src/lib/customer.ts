// The public /apply KYC wizard creates a customer account partway through and
// then PATCHes the rest of the profile + uploads documents against the
// customer API. That bearer token is deliberately NOT persisted (§17.6: the
// web has no ongoing buyer portal) — it lives only in the wizard component's
// React state for the length of the session. This helper is the customer-side
// equivalent of lib/auth.ts's apiFetch, but the token is passed in rather than
// read from localStorage.

const BASE = process.env.NEXT_PUBLIC_API_URL;

export async function customerFetch(
  path: string,
  token: string,
  init: RequestInit = {},
): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  // Let the browser set the multipart boundary for FormData bodies.
  if (!(init.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  return fetch(`${BASE}${path}`, { ...init, headers });
}

export async function readError(res: Response): Promise<string> {
  try {
    const body = await res.json();
    if (typeof body?.message === "string") return body.message;
    if (Array.isArray(body?.message)) return body.message.join(", ");
    if (body?.fieldErrors) {
      const first = Object.values(body.fieldErrors)[0];
      if (Array.isArray(first) && first[0]) return String(first[0]);
    }
  } catch {
    /* fall through */
  }
  return `Something went wrong (${res.status})`;
}
