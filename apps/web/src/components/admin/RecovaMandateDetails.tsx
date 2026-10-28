"use client";

import { useState } from "react";
import { apiFetch } from "../../lib/auth";
import { RECOVA_BANKS } from "../../lib/recova-banks";

// Staff view of Recova's own mandate record (RetrieveMandateByLoanReference).
// The API masks BVN, account, phone and email before they reach the browser.
type Lookup = { httpStatus: number; ok: boolean; body: unknown };
type Mandate = Record<string, unknown>;

const naira = (v: unknown) =>
  typeof v === "number" ? new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN" }).format(v) : "—";
const text = (v: unknown) => (v === null || v === undefined || v === "" ? "—" : String(v));

function pickMandate(body: unknown, reference: string): Mandate | null {
  const rows = Array.isArray(body) ? body : [body];
  const match = rows.find((r) => r && typeof r === "object" && (r as Mandate).loanReference === reference);
  return (match as Mandate | undefined) ?? null;
}

export function RecovaMandateDetails({ reference }: { reference: string }) {
  const [mandate, setMandate] = useState<Mandate | null>(null);
  const [checkedAt, setCheckedAt] = useState<Date | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch(`/v1/admin/recova/production/mandate/${encodeURIComponent(reference)}`, { cache: "no-store" });
      const body = (await res.json()) as Lookup & { message?: string };
      if (!res.ok) throw new Error(body.message ?? `Lookup failed (${res.status})`);
      if (body.httpStatus === 404) throw new Error("Recova has no mandate for this reference yet. The customer may not have approved the token.");
      if (!body.ok) throw new Error(`Recova answered with HTTP ${body.httpStatus}.`);
      const found = pickMandate(body.body, reference);
      if (!found) throw new Error("Recova's reply didn't include this loan reference.");
      setMandate(found);
      setCheckedAt(new Date());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Lookup failed");
    } finally {
      setBusy(false);
    }
  }

  const bank = mandate && RECOVA_BANKS.find((b) => b.code === mandate.preferredRepaymentBankCBNCode)?.name;
  const rows: Array<[string, string]> = mandate
    ? [
        ["Mandate status", text(mandate.status)],
        ["Customer", text(mandate.customerName)],
        ["Repayment type", text(mandate.repaymentType)],
        ["Loan amount", naira(mandate.loanAmount)],
        ["Expected repayment", naira(mandate.totalRepaymentExpected)],
        ["Loan tenure", text(mandate.loanTenure)],
        ["Repayment bank", bank ?? text(mandate.preferredRepaymentBankCBNCode)],
        ["Repayment account", text(mandate.preferredRepaymentAccount)],
        ["Phone", text(mandate.phoneNumber)],
        ["Proactive sweep", mandate.enableProactiveSweep === true ? "On" : mandate.enableProactiveSweep === false ? "Off" : "—"],
        ["Consent channel", text(mandate.consentReceiptChannel)],
        ["Comment", text(mandate.comment)],
      ]
    : [];

  return (
    <div className="mt-4 border-t pt-4">
      <div className="flex items-center justify-between gap-3">
        <h4 className="text-sm font-semibold text-text-dark">Recova mandate details</h4>
        <button className="text-sm font-semibold text-primary underline disabled:opacity-40" disabled={busy} onClick={() => void load()}>
          {busy ? "Checking…" : mandate ? "Refresh" : "Load from Recova"}
        </button>
      </div>
      {error && <p role="alert" className="mt-2 text-sm text-error">{error}</p>}
      {mandate && (
        <>
          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
            {rows.map(([label, value]) => (
              <div key={label} className="contents">
                <dt className="text-text-muted">{label}</dt>
                <dd className="break-all text-text-dark">{value}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-3 text-xs text-text-muted">
            Checked {checkedAt?.toLocaleString("en-GB", { timeZone: "Africa/Lagos" })}. Amounts deducted, sweep history and linked
            accounts are only in Recova&apos;s dashboard for now.
          </p>
        </>
      )}
    </div>
  );
}
