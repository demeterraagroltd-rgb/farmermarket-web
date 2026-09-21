"use client";

import { useState } from "react";
import { apiFetch } from "../../../lib/auth";

// The single way the Customer 360 page reaches Mono: an explicit admin click on
// POST /v1/admin/customers/:id/refresh-bank-data. Opening the page, switching
// tabs and re-rendering never call it. Shared by the header, the Overview's
// freshness panel and the Bank Accounts tab so all three behave — and report —
// identically.
export function useBankRefresh(customerId: string, onDone: () => void) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  async function refresh() {
    setBusy(true);
    setMessage(null);
    try {
      const res = await apiFetch(`/v1/admin/customers/${customerId}/refresh-bank-data`, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.message ?? "Couldn't refresh bank data");
      setMessage({
        tone: "ok",
        text: body.keptPreviousData
          ? "Mono returned nothing new, so the previous data was kept."
          : "Bank data refreshed.",
      });
      onDone();
    } catch (e) {
      setMessage({ tone: "error", text: e instanceof Error ? e.message : "Couldn't refresh bank data" });
    } finally {
      setBusy(false);
    }
  }

  return { refresh, busy, message, clear: () => setMessage(null) };
}
