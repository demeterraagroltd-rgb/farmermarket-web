// Simplest possible session strategy for now — localStorage, no refresh-token
// rotation yet. The plan's real design (§11.4 shell, httpOnly refresh cookie)
// lands with the dashboard shell; this just makes the admin loop functional.
const TOKEN_KEY = "farmermarket_staff_token";

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  window.localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  window.localStorage.removeItem(TOKEN_KEY);
}

export async function apiFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const token = getToken();
  const headers = new Headers(options.headers);
  headers.set("Content-Type", "application/json");
  if (token) headers.set("Authorization", `Bearer ${token}`);

  return fetch(`${process.env.NEXT_PUBLIC_API_URL}${path}`, { ...options, headers });
}
