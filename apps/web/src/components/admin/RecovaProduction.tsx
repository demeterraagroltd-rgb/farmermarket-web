"use client";

import { useEffect, useState } from "react";
import { RECOVA_STATUS_LABEL } from "../../lib/recova-status";
import { apiFetch } from "../../lib/auth";
import { Card } from "../ui/Card";
import { RecovaReadiness, type RecovaReadinessReport } from "./RecovaReadiness";

type Status = { enabled: boolean; tokenConfigured: boolean; configurationReady: boolean; destination: string | null; institutionCode: string | null; issues: string[];
  readiness?: RecovaReadinessReport;
  customerSetup?: { draftAvailable: boolean; submissionEnabled: boolean; issues: string[] } };
type ConsentRow = { reference: string; status: string; purpose: string; bankCode: string; accountLast4: string;
  submittedAt: string | null; createdAt: string; orderId: string; total: number; customerName: string | null };
const RESENDABLE = new Set(["awaiting_consent", "needs_review", "expired"]);
const when = (iso: string | null) => iso ? new Date(iso).toLocaleString("en-GB", { timeZone: "Africa/Lagos", dateStyle: "medium", timeStyle: "short" }) : "—";
export function RecovaProduction() {
  const [status, setStatus] = useState<Status | null>(null);
  const [reference, setReference] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<unknown>(null);
  const [consents, setConsents] = useState<ConsentRow[] | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  async function loadConsents() {
    try {
      const response = await apiFetch("/v1/admin/recova/production/consents", { cache: "no-store" });
      if (response.ok) setConsents(await response.json());
    } catch { /* the list is a convenience; lookups below still work */ }
  }
  useEffect(() => { void loadConsents(); }, []);
  async function check(path: string) {
    setBusy(true); setError(null); setResult(null);
    try {
      const response = await apiFetch(`/v1/admin/recova/production/${path}`, { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.message ?? `Request failed (${response.status})`);
      if (path === "status") setStatus(body);
      else setResult(body);
    } catch (e) { setError(e instanceof Error ? e.message : "Request failed"); }
    finally { setBusy(false); }
  }
  async function resend(row: ConsentRow) {
    if (!window.confirm(`Ask Recova to text ${row.customerName ?? "this customer"} their approval token again?`)) return;
    setBusy(true); setError(null); setResult(null); setNotice(null);
    try {
      const response = await apiFetch(`/v1/admin/recova/production/consent/${encodeURIComponent(row.reference)}/resend`, { method: "POST" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.message ?? `Request failed (${response.status})`);
      setResult(body);
      setNotice(body.ok
        ? `Recova accepted the resend for ${row.customerName ?? "the customer"}. The SMS should arrive within a few minutes.`
        : `Recova did not accept the resend (HTTP ${body.httpStatus}). See the response below.`);
    } catch (e) { setError(e instanceof Error ? e.message : "Request failed"); }
    finally { setBusy(false); }
  }
  const button = "rounded-lg bg-emerald-800 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40";
  return <Card className="space-y-4 p-6">
    <h2 className="text-xl font-bold">Recova readiness checks</h2>
    <p className="text-sm text-slate-600">Check what Farmer Market needs for customer authorization, SMS, collection, recovery and repayment reconciliation. Refresh after changing server settings.</p>
    <button className={button} disabled={busy} onClick={() => void check("status")}>{status ? "Refresh readiness checks" : "Check repayment readiness"}</button>
    {!status && <p className="text-sm text-slate-500">Run the check to see current configuration and remaining launch requirements. No SMS or debit is sent.</p>}
    {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}{status && " The results below are from the previous successful check."}</p>}
    {status?.readiness && <RecovaReadiness report={status.readiness} />}
    {status && !status.readiness && <div className="space-y-2 rounded-lg bg-slate-50 p-4 text-sm">
      <p className="rounded-lg bg-amber-50 p-3 text-amber-900">The API is returning the earlier configuration report. The full readiness checklist will appear after the API update is deployed.</p>
      <p className="font-semibold">{status.configurationReady ? "Configuration ready — connection has not yet been verified" : "Production connection is not configured yet"}</p>
      <p>Lookups: {status.enabled ? "enabled" : "disabled"} · Production token: {status.tokenConfigured ? "configured" : "missing or invalid"}</p>
      {status.institutionCode && <p>Configured institution: {status.institutionCode} (not yet verified against the token)</p>}
      {status.destination && <p className="break-all">API destination: {status.destination}</p>}
      {status.customerSetup && <div className="space-y-2 border-t pt-3">
        <p>Customer setup drafts: {status.customerSetup.draftAvailable ? "available" : "not configured"} · Live consent requests: {status.customerSetup.submissionEnabled ? "enabled" : "disabled"}</p>
        <p>Customers open Account → Orders → their approved order → Set up repayment with Recova.</p>
        {!!status.customerSetup.issues.length && <ul className="list-disc pl-5">{status.customerSetup.issues.map(issue => <li key={issue}>{issue}</li>)}</ul>}
      </div>}
      {!!status.issues.length && <ul className="list-disc space-y-1 pl-5">{status.issues.map((issue) => <li key={issue}>{issue}</li>)}</ul>}
    </div>}
    <div className="border-t pt-5">
      <div className="mb-2 flex items-center justify-between gap-3">
        <h3 className="font-semibold">Customer repayment setups</h3>
        <button className="text-sm font-semibold text-emerald-800 underline" disabled={busy} onClick={() => void loadConsents()}>Reload</button>
      </div>
      {consents === null ? <p className="text-sm text-slate-500">Loading…</p>
        : consents.length === 0 ? <p className="text-sm text-slate-500">No customer has started Recova repayment setup yet.</p>
        : <div className="overflow-x-auto"><table className="w-full text-left text-sm">
          <thead className="text-xs text-slate-500"><tr><th className="p-2">Customer</th><th className="p-2">Status</th><th className="p-2">Amount</th><th className="p-2">Account</th><th className="p-2">Sent</th><th className="p-2">Loan reference</th><th className="p-2" /></tr></thead>
          <tbody>{consents.map((c) => <tr key={c.reference} className="border-t align-top">
            <td className="p-2"><a className="font-semibold text-emerald-800 underline" href={`/dashboard/orders/${c.orderId}/review`}>{c.customerName ?? "Customer"}</a></td>
            <td className="p-2">{RECOVA_STATUS_LABEL[c.status] ?? c.status}</td>
            <td className="p-2">{new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN" }).format(c.total)}</td>
            <td className="p-2">{c.purpose} · ••{c.accountLast4}</td>
            <td className="p-2 whitespace-nowrap">{when(c.submittedAt)}</td>
            <td className="p-2 break-all font-mono text-xs">{c.reference}</td>
            <td className="p-2 space-y-1">
              <button className="block text-sm font-semibold text-emerald-800 underline" disabled={busy} onClick={() => setReference(c.reference)}>Use below</button>
              {RESENDABLE.has(c.status) && <button className="block whitespace-nowrap text-sm font-semibold text-emerald-800 underline disabled:opacity-40" disabled={busy} onClick={() => void resend(c)}>Resend token</button>}
            </td>
          </tr>)}</tbody>
        </table></div>}
      {notice && <p role="status" className="mt-3 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900">{notice}</p>}
    </div>
    <div className="border-t pt-5">
    <h3 className="mb-2 font-semibold">Read an existing Recova record</h3>
    <p className="mb-3 text-sm text-slate-600">Use a genuine production loan reference to inspect consent or mandate details. A missing record (404) does not verify authentication. These lookups do not collect money.</p>
    <label className="block text-sm">Production loan reference
      <input className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" value={reference} disabled={busy} autoComplete="off" onChange={(e) => setReference(e.target.value)} placeholder="Reference supplied by Recova or an existing production loan" />
    </label>
    <div className="flex flex-wrap gap-3">
      <button className={button} disabled={busy || !status?.configurationReady || !reference.trim()} onClick={() => void check(`mandate/${encodeURIComponent(reference.trim())}`)}>Read production mandate</button>
      <button className={button} disabled={busy || !status?.configurationReady || !reference.trim()} onClick={() => void check(`consent/${encodeURIComponent(reference.trim())}`)}>Read production consent</button>
    </div>
    {busy && <p role="status" className="text-sm text-slate-500">Checking…</p>}
    {result !== null && <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-slate-950 p-4 text-xs text-slate-100">{JSON.stringify(result, null, 2)}</pre>}
    </div>
  </Card>;
}
