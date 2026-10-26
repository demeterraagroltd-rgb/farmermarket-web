"use client";

import { useState } from "react";
import { apiFetch } from "../../../../lib/auth";
import { Card, PageHeader } from "../../../../components/ui/Card";
import { RecovaJourney } from "../../../../components/admin/RecovaJourney";
import { RecovaProduction } from "../../../../components/admin/RecovaProduction";

const initialSchedule = [
  { dueDate: "2026-11-21", amountKobo: 2_200_000, paidKobo: 2_200_000 },
  { dueDate: "2026-12-21", amountKobo: 2_200_000, paidKobo: 0 },
  { dueDate: "2027-01-21", amountKobo: 2_200_000, paidKobo: 0 },
];
const field = "mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm";
const button = "rounded-lg bg-emerald-800 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40";
const developmentTools = process.env.NODE_ENV !== "production";
type Preview = {
  stage: string; hold: string | null; outstandingKobo: number; dueKobo: number;
  collectionTargetKobo: number; recoveryTargetKobo: number; recoveryEligibleAt: string; executionBlock: string;
};
const ngn = (kobo: number) => new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN" }).format(kobo / 100);

export default function RecovaIntegrationPage() {
  const [schedule, setSchedule] = useState(initialSchedule);
  const [asOf, setAsOf] = useState("2026-12-22T09:00");
  const [graceDays, setGraceDays] = useState(0);
  const [pendingPayment, setPendingPayment] = useState(false);
  const [unresolvedDebit, setUnresolvedDebit] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [connection, setConnection] = useState<{ enabled: boolean; tokenConfigured: boolean } | null>(null);
  const [reference, setReference] = useState("");
  const [testDataConfirmed, setTestDataConfirmed] = useState(false);
  const [tenureUnitsConfirmed, setTenureUnitsConfirmed] = useState(false);
  const [form, setForm] = useState({ customerID: "", customerName: "", customerEmail: "", phoneNumber: "", bvn: "",
    preferredRepaymentBankCBNCode: "", preferredRepaymentAccount: "", loanAmountNaira: "60000", loanTenure: "3", repaymentType: "Recovery" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [response, setResponse] = useState<unknown>(null);

  const approvalUrl = (() => {
    const url = (response as { body?: { consentApprovalUrl?: unknown } } | null)?.body?.consentApprovalUrl;
    return typeof url === "string" && url.startsWith("https://") ? url : null;
  })();

  async function call(path: string, payload?: unknown) {
    setBusy(true); setError(null); setResponse(null);
    try {
      const r = await apiFetch(`/v1/admin/recova/sandbox/${path}`, payload === undefined ? {} : { method: "POST", body: JSON.stringify(payload) });
      const body = await r.json();
      if (!r.ok) throw new Error(typeof body.message === "string" ? body.message : `Request failed (${r.status})`);
      if (path === "preview") setPreview(body);
      else if (path === "status") setConnection(body);
      setResponse(body);
    } catch (e) { setError(e instanceof Error ? e.message : "Request failed"); }
    finally { setBusy(false); }
  }

  function simulate() {
    setPreview(null);
    void call("preview", { installments: schedule, asOf: `${asOf}:00+01:00`, graceDays, pendingPayment, unresolvedDebit });
  }

  function createConsent() {
    try {
      const rows = schedule;
      // A new consent is for a fresh test loan, not a previously paid scenario.
      if (!Array.isArray(rows) || rows.some((r) => r.paidKobo !== 0)) throw new Error("Set all paidKobo values to 0 before creating a new test consent.");
      const { loanAmountNaira, ...details } = form;
      void call("consent", { ...details, loanReference: reference, loanTenure: Number(form.loanTenure),
        loanAmountKobo: Math.round(Number(loanAmountNaira) * 100), testDataConfirmed, tenureUnitsConfirmed,
        installments: rows.map(({ dueDate, amountKobo }) => ({ dueDate, amountKobo })),
      });
    } catch (e) { setError(e instanceof Error ? e.message : "Check the schedule."); }
  }

  return <fieldset disabled={busy} aria-busy={busy} className="min-w-0 space-y-6">
    <PageHeader title="Recova integration" description={developmentTools ? "Production connection, guided practice and staging tools." : "Production authorization setup and mandate lookups."} />
    <RecovaProduction />
    {developmentTools && <>
    <RecovaJourney />
    <details className="rounded-xl border border-slate-200 p-4"><summary className="cursor-pointer font-semibold">Advanced: policy calculator and actual Recova staging requests</summary><div className="mt-5 space-y-6">
    <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
      Sandbox only. No real repayment balances are changed. Recovery eligibility is a preview; automatic sweeps and live debits are not enabled.
    </div>
    {error && <p role="alert" className="whitespace-pre-wrap rounded-lg bg-red-50 p-4 text-sm text-red-800">{error}</p>}
    <Card className="space-y-4 p-6">
      <h2 className="text-lg font-semibold">1. Check configuration</h2>
      <p className="text-sm text-slate-600">The bearer token stays on the API server. This checks configuration; a lookup below tests the provider response.</p>
      <button className={button} disabled={busy} onClick={() => void call("status")}>Check sandbox configuration</button>
      {connection && <p className="text-sm">Sandbox {connection.enabled ? "enabled" : "disabled"} · Token {connection.tokenConfigured ? "configured" : "missing"}</p>}
    </Card>
    <Card className="space-y-4 p-6">
      <h2 className="text-lg font-semibold">2. Explore the repayment policy</h2>
      <p className="text-sm text-slate-600">Due amounts roll forward during the tenor. Recovery becomes eligible the day after the final due date, plus optional grace days. Additional interest and penalties are zero.</p>
      <div className="overflow-x-auto"><table className="w-full text-left text-sm">
        <thead><tr><th className="p-2">Instalment</th><th className="p-2">Due date</th><th className="p-2">Amount (₦)</th><th className="p-2">Paid (₦)</th></tr></thead>
        <tbody>{schedule.map((row, index) => <tr key={index}>
          <td className="p-2">{index + 1}</td>
          <td className="p-2"><input aria-label={`Due date for instalment ${index + 1}`} type="date" className={field} value={row.dueDate} onChange={(e) => { setSchedule(schedule.map((r, i) => i === index ? { ...r, dueDate: e.target.value } : r)); setPreview(null); }} /></td>
          <td className="p-2"><input aria-label={`Amount for instalment ${index + 1}`} type="number" min="0.01" step="0.01" className={field} value={row.amountKobo / 100} onChange={(e) => { setSchedule(schedule.map((r, i) => i === index ? { ...r, amountKobo: Math.round(Number(e.target.value) * 100) } : r)); setPreview(null); }} /></td>
          <td className="p-2"><input aria-label={`Paid for instalment ${index + 1}`} type="number" min="0" step="0.01" className={field} value={row.paidKobo / 100} onChange={(e) => { setSchedule(schedule.map((r, i) => i === index ? { ...r, paidKobo: Math.round(Number(e.target.value) * 100) } : r)); setPreview(null); }} /></td>
        </tr>)}</tbody>
      </table></div>
      <button className={button} disabled={busy} onClick={() => { setSchedule(schedule.map((r) => ({ ...r, paidKobo: 0 }))); setPreview(null); }}>Reset payments for a fresh test loan</button>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="text-sm">Scenario time (Nigeria)<input className={field} type="datetime-local" value={asOf} onChange={(e) => { setAsOf(e.target.value); setPreview(null); }} /></label>
        <label className="text-sm">Extra grace days after maturity<input className={field} type="number" min={0} max={90} value={graceDays} onChange={(e) => { setGraceDays(Number(e.target.value)); setPreview(null); }} /></label>
      </div>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={pendingPayment} onChange={(e) => { setPendingPayment(e.target.checked); setPreview(null); }} />Voluntary payment awaiting reconciliation</label>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={unresolvedDebit} onChange={(e) => { setUnresolvedDebit(e.target.checked); setPreview(null); }} />A debit has an unresolved outcome</label>
      <button className={button} disabled={busy} onClick={simulate}>Preview collection / recovery</button>
      {preview && <div aria-live="polite" className="space-y-3 rounded-xl bg-emerald-50 p-4">
        <p className="font-semibold">Stage: {preview.stage}{preview.hold ? ` · On hold: ${preview.hold.replaceAll("_", " ")}` : ""}</p>
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <div><dt>Outstanding</dt><dd>{ngn(preview.outstandingKobo)}</dd></div>
          <div><dt>Currently due</dt><dd>{ngn(preview.dueKobo)}</dd></div>
          <div><dt>Collection target</dt><dd>{ngn(preview.collectionTargetKobo)}</dd></div>
          <div><dt>Recovery target</dt><dd>{ngn(preview.recoveryTargetKobo)}</dd></div>
        </dl>
        <p className="text-sm">Recovery eligible from {new Date(preview.recoveryEligibleAt).toLocaleString("en-GB", { timeZone: "Africa/Lagos" })} WAT.</p>
        <p className="text-xs">{preview.executionBlock}</p>
      </div>}
    </Card>
    <Card className="space-y-4 p-6">
      <h2 className="text-lg font-semibold">3. Test Recova consent and mandate lookup</h2>
      <p className="text-sm text-slate-600">Use test identity and bank details supplied by Recova. Creating consent can send an SMS through their configured callback. Use future dates and reset payments to zero for a fresh test loan.</p>
      <label className="block text-sm">Test loan reference<input className={field} value={reference} onChange={(e) => setReference(e.target.value)} placeholder="fm-sandbox-…" /></label>
      <button className={button} disabled={busy} onClick={() => setReference(`fm-sandbox-${crypto.randomUUID()}`)}>New test reference</button>
      <div className="grid gap-4 sm:grid-cols-2">
        {([
          ["customerID", "Test customer ID"], ["customerName", "Test customer name"], ["customerEmail", "Test email"],
          ["phoneNumber", "Test phone"], ["bvn", "Test BVN"], ["preferredRepaymentBankCBNCode", "Bank CBN code"],
          ["preferredRepaymentAccount", "Test account number"], ["loanAmountNaira", "Loan principal (naira)"], ["loanTenure", "Provider loanTenure value"],
        ] as const).map(([key, label]) => <label key={key} className="text-sm">{label}<input className={field} value={form[key]} autoComplete="off" onChange={(e) => setForm({ ...form, [key]: e.target.value })} /></label>)}
        <label className="text-sm">Mandate purpose<select className={field} value={form.repaymentType} onChange={(e) => setForm({ ...form, repaymentType: e.target.value })}><option value="Recovery">Recovery (planned first release)</option><option value="Collection">Collection (phase 2)</option></select></label>
      </div>
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={testDataConfirmed} onChange={(e) => setTestDataConfirmed(e.target.checked)} />I am using approved sandbox test identity, phone and bank details.</label>
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={tenureUnitsConfirmed} onChange={(e) => setTenureUnitsConfirmed(e.target.checked)} />Recova has confirmed the units for the loanTenure value above.</label>
      <div className="flex flex-wrap gap-3">
        <button className={button} disabled={busy || !testDataConfirmed || !tenureUnitsConfirmed || !reference} onClick={createConsent}>Create staging consent</button>
        <button className={button} disabled={busy || !reference} onClick={() => void call(`consent/${encodeURIComponent(reference)}`)}>Retrieve consent</button>
        <button className={button} disabled={busy || !reference} onClick={() => void call(`mandate/${encodeURIComponent(reference)}`)}>Retrieve mandate</button>
        <button className={button} disabled={busy || !reference} onClick={() => void call(`consent/${encodeURIComponent(reference)}/resend`, {})}>Resend consent message</button>
        <button className={button} disabled={busy || !reference} onClick={() => { if (confirm("Cancel this test mandate on Recova staging?")) void call(`mandate/${encodeURIComponent(reference)}/cancel`, {}); }}>Cancel test mandate</button>
      </div>
      {approvalUrl && <p className="rounded-lg bg-emerald-50 p-3 text-sm">Approve as the test customer: <a className="font-semibold text-emerald-800 underline" href={approvalUrl} target="_blank" rel="noreferrer noopener">open Recova consent page</a></p>}
      <p className="text-xs text-slate-600">After a submission or timeout, look up the same reference. Submission does not confirm mandate activation or payment. Test entries stay in memory on this page and are cleared when you leave.</p>
    </Card>
    <Card className="p-6"><h2 className="mb-3 text-lg font-semibold">Latest response {busy && "· Working…"}</h2>
      <pre aria-live="polite" className="max-h-96 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-slate-950 p-4 text-xs text-slate-100">{response === null ? "Run a preview or staging lookup to see the result." : JSON.stringify(response, null, 2)}</pre>
    </Card>
    </div></details>
    </>}
  </fieldset>;
}
