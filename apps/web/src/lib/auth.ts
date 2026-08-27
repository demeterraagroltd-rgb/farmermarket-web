// Simplest possible session strategy for now — localStorage, no refresh-token
// rotation yet. The plan's real design (§11.4 shell, httpOnly refresh cookie)
// lands with the dashboard shell; this just makes the admin loop functional.
const TOKEN_KEY = "farmermarket_staff_token";
const ROLE_KEY = "farmermarket_staff_role";
const EMAIL_KEY = "farmermarket_staff_email";

export type StaffRole = "super_admin" | "admin" | "credit" | "sales";

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(TOKEN_KEY);
}

// Login already returns `role` in the response body — it just wasn't being
// kept anywhere. Storing it (plus the email the staff member typed) is what
// lets the dashboard shell filter its own nav instead of showing every
// section to every role.
export function setSession(token: string, role: string, email: string): void {
  window.localStorage.setItem(TOKEN_KEY, token);
  window.localStorage.setItem(ROLE_KEY, role);
  window.localStorage.setItem(EMAIL_KEY, email);
}

export function getRole(): StaffRole | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(ROLE_KEY) as StaffRole | null;
}

export function getStaffEmail(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(EMAIL_KEY);
}

export function clearToken(): void {
  window.localStorage.removeItem(TOKEN_KEY);
  window.localStorage.removeItem(ROLE_KEY);
  window.localStorage.removeItem(EMAIL_KEY);
}

export async function apiFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const token = getToken();
  const headers = new Headers(options.headers);
  headers.set("Content-Type", "application/json");
  if (token) headers.set("Authorization", `Bearer ${token}`);

  return fetch(`${process.env.NEXT_PUBLIC_API_URL}${path}`, { ...options, headers });
}
