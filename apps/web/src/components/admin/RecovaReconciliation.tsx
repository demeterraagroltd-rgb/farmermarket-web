"use client";
import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "../../lib/auth";
import { formatNaira } from "../../lib/format";
import { RECOVA_STATUS_LABEL } from "../../lib/recova-status";
import { Card } from "../ui/Card";

type Loan = { reference: string; mandateStatus: string; orderId: string; orderStatus: string; customerName: string | null; installmentCount: number;
  scheduledKobo: string; paidKobo: string; outstandingKobo: string | null; dueKobo: string; ledgerConsistent: boolean; pendingReports: number; reportedKobo: string; repaymentStatus: string };
type Overview = { checkedAt: string; loans: Loan[]; limit: number };
type Report = { id: string; channel: string; sourceName: string; transactionReference: string; amountKobo: string; observedAt: string; note: string; status: string; dismissalReason: string | null };
type Detail = { reference: string; checkedAt: string; installments: { id: string; number: number; dueDate: string; amountKobo: string; paidKobo: string }[];
  payments: { id: string; installment: number; amountKobo: string; paidAt: string }[]; reports: Report[]; limit: number };
const labels: Record<string, string> = { not_booked: "Schedule not booked", ledger_review: "Ledger review required", paid_in_ledger: "Paid in Farmer Market",
  part_paid_in_ledger: "Part paid in Farmer Market", overdue_in_ledger: "Overdue in Farmer Market", not_yet_due: "Not yet due" };
const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { timeZone: "Africa/Lagos", dateStyle: "medium", timeStyle: "short" });
const input = "mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2";
const button = "rounded-lg bg-emerald-800 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40";
async function request(path: string, options: RequestInit = {}) {
  const response = await apiFetch(`/v1/admin/recova/reconciliation${path}`, { cache: "no-store", ...options });
  const body = await response.json();
  if (!response.ok) throw new Error(body.message ?? `Request failed (${response.status})`);
  return body;
}

export function RecovaReconciliation() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [selected, setSelected] = useState("");
  const [detail, setDetail] = useState<Detail | null>(null);
  const [query, setQuery] = useState("");
  const [pendingOnly, setPendingOnly] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [dismissId, setDismissId] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setOverview(await request("")); }
    catch (e) { setError(e instanceof Error ? e.message : "Unable to load payments"); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    setDetail(null); setDetailError(null); setNotice(null); setDismissId(null);
    if (!selected) return;
    const controller = new AbortController();
    void request(`/${encodeURIComponent(selected)}`, { signal: controller.signal }).then(result => { if (!controller.signal.aborted) setDetail(result); }).catch(e => {
      if (!controller.signal.aborted) setDetailError(e instanceof Error ? e.message : "Unable to load payment history");
    });
    return () => controller.abort();
  }, [selected]);
  async function reloadDetail() { setDetail(await request(`/${encodeURIComponent(selected)}`)); }
  async function report(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = event.currentTarget; const data = new FormData(form);
    setBusy(true); setDetailError(null); setNotice(null);
    try {
      const observed = new Date(String(data.get("observedAt")));
      if (!Number.isFinite(observed.getTime())) throw new Error("Choose a valid payment date and time.");
      await request(`/${encodeURIComponent(selected)}/reports`, { method: "POST", body: JSON.stringify({
        channel: data.get("channel"), sourceName: data.get("sourceName"), transactionReference: data.get("transactionReference"),
        amountNaira: data.get("amountNaira"), observedAt: observed.toISOString(), note: data.get("note"),
      }) });
      setNotice("Report saved for verification. No repayment was posted and the customer's balance has not changed."); form.reset();
      await Promise.all([reloadDetail(), load()]);
    } catch (e) { setDetailError(e instanceof Error ? e.message : "Unable to save report"); }
    finally { setBusy(false); }
  }
  async function dismiss() {
    if (!dismissId) return;
    setBusy(true); setDetailError(null); setNotice(null);
    try {
      await request(`/reports/${dismissId}/dismiss`, { method: "POST", body: JSON.stringify({ reason }) });
      setDismissId(null); setReason(""); setNotice("Report dismissed with an audit record. No payment or balance was changed.");
      await Promise.all([reloadDetail(), load()]);
    } catch (e) { setDetailError(e instanceof Error ? e.message : "Unable to dismiss report"); }
    finally { setBusy(false); }
  }
  const loan = overview?.loans.find(row => row.reference === selected);
  const visible = overview?.loans.filter(row => (!pendingOnly || row.pendingReports > 0) && `${row.customerName ?? ""} ${row.reference}`.toLowerCase().includes(query.toLowerCase()));
  return <Card className="space-y-5 p-6">
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-xl font-bold">Payments and reconciliation</h2><button className={button} disabled={loading || busy} onClick={() => void load()}>{loading ? "Refreshing…" : "Refresh payment overview"}</button></div>
    <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
      <p className="font-semibold">Automatic Recova payment verification and balance updates are awaiting integration.</p>
      <p className="mt-1">An active mandate means authorization, not money received. Balances below come from Farmer Market's repayment records. Staff reports remain unverified until matched to provider transactions and settlement evidence.</p>
      <p className="mt-1">This page cannot debit an account, mark a payment successful or post a repayment.</p>
    </div>
    {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}{overview && " The overview below is from the previous successful check."}</p>}
    {overview && <>
      <p className="text-xs text-slate-500">Checked {when(overview.checkedAt)} WAT · Latest {overview.limit} repayment setups. An empty queue does not establish that Recova collected no money.</p>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg bg-slate-50 p-4"><p className="text-2xl font-bold">{overview.loans.length}</p><p className="text-sm">Repayment setups shown</p></div>
        <div className="rounded-lg bg-amber-50 p-4"><p className="text-2xl font-bold">{overview.loans.reduce((sum, row) => sum + row.pendingReports, 0)}</p><p className="text-sm">Reports awaiting verification</p></div>
        <div className="rounded-lg bg-slate-50 p-4"><p className="text-2xl font-bold">{formatNaira(overview.loans.reduce((sum, row) => sum + Number(row.reportedKobo), 0))}</p><p className="text-sm">Reported, not posted</p></div>
      </div>
      <div className="flex flex-wrap items-end gap-4"><label className="min-w-0 flex-1 text-sm">Find customer or loan reference<input className={input} value={query} onChange={e => setQuery(e.target.value)} /></label>
        <label className="flex items-center gap-2 py-2 text-sm"><input type="checkbox" checked={pendingOnly} onChange={e => setPendingOnly(e.target.checked)} />Only awaiting verification</label></div>
      {!visible?.length ? <p className="text-sm text-slate-600">No repayment setups match this view.</p> : <div className="overflow-x-auto"><table className="w-full text-left text-sm">
        <thead><tr>{["Customer / loan", "Authorization", "Farmer Market payments", "Outstanding", "Reports", "Review"].map(label => <th key={label} className="p-2">{label}</th>)}</tr></thead>
        <tbody>{visible.map(row => <tr key={row.reference} className="border-t align-top">
          <td className="p-2"><p className="font-semibold">{row.customerName ?? "Customer"}</p><p className="max-w-64 break-all font-mono text-xs text-slate-500">{row.reference}</p></td>
          <td className="p-2">{RECOVA_STATUS_LABEL[row.mandateStatus] ?? row.mandateStatus}</td>
          <td className="p-2"><p>{formatNaira(row.paidKobo)}</p><p className="text-xs text-slate-600">{labels[row.repaymentStatus]}</p></td>
          <td className="p-2">{formatNaira(row.outstandingKobo)}<p className="text-xs text-slate-600">Due now: {formatNaira(row.dueKobo)}</p></td>
          <td className="p-2">{row.pendingReports} awaiting verification{row.outstandingKobo !== null && BigInt(row.reportedKobo) > BigInt(row.outstandingKobo) && <p className="text-xs text-amber-800">Reported amount exceeds the balance. Review allocation and fees.</p>}</td>
          <td className="p-2"><button className="font-semibold text-emerald-800 underline disabled:opacity-40" disabled={busy || selected === row.reference} onClick={() => setSelected(row.reference)}>View payments and reports</button></td>
        </tr>)}</tbody>
      </table></div>}
    </>}
    {selected && <section className="space-y-4 border-t pt-5" aria-label="Loan reconciliation detail">
      <h3 className="font-semibold">Payment review · {loan?.customerName ?? "Customer"}</h3><p className="break-all font-mono text-xs">{selected}</p>
      {detailError && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{detailError}</p>}
      {notice && <p role="status" className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900">{notice}</p>}
      {!detail && !detailError && <p role="status">Loading payment history…</p>}
      {detail && <>
        <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-xs text-slate-500">History loaded {when(detail.checkedAt)} WAT</p><button className="text-sm font-semibold text-emerald-800 underline" disabled={busy} onClick={() => { setBusy(true); setDetailError(null); void reloadDetail().catch(e => setDetailError(e instanceof Error ? e.message : "Unable to refresh history")).finally(() => setBusy(false)); }}>Refresh loan history</button></div>
        <h4 className="font-semibold">Booked installments</h4>
        {!detail.installments.length ? <p className="text-sm">No repayment schedule is booked for this order yet.</p> : <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr><th className="p-2">Installment</th><th className="p-2">Due (WAT)</th><th className="p-2">Scheduled</th><th className="p-2">Recorded paid</th></tr></thead><tbody>{detail.installments.map(row => <tr key={row.id} className="border-t"><td className="p-2">{row.number}</td><td className="p-2">{when(row.dueDate)}</td><td className="p-2">{formatNaira(row.amountKobo)}</td><td className="p-2">{formatNaira(row.paidKobo)}</td></tr>)}</tbody></table></div>}
        <h4 className="font-semibold">Posted payment history</h4><p className="text-xs text-slate-500">Latest {detail.limit} Farmer Market repayment records. These records do not identify Recova as the source.</p>
        {!detail.payments.length ? <p className="text-sm">No repayments are recorded for this loan. Check Recova's statement before concluding that no money was collected.</p> : <ul className="space-y-2">{detail.payments.map(payment => <li key={payment.id} className="rounded-lg bg-slate-50 p-3 text-sm">{formatNaira(payment.amountKobo)} · Installment {payment.installment} · {when(payment.paidAt)} WAT<p className="break-all font-mono text-xs">Receipt {payment.id}</p></li>)}</ul>}
        <h4 className="font-semibold">Reports for verification</h4><p className="text-sm text-slate-600">Latest {detail.limit} reports. Check transaction status, settlement, fees and allocation with finance. Do not request another debit while a possible payment is unresolved. Dismissing a report does not stop Recova collection.</p>
        {!detail.reports.length ? <p className="text-sm text-slate-500">No payment reports have been recorded.</p> : <ul className="space-y-3">{detail.reports.map(row => <li key={row.id} className="space-y-2 rounded-lg border p-4 text-sm">
          <div className="flex flex-wrap justify-between gap-2"><strong>{formatNaira(row.amountKobo)} · {row.channel}</strong><span>{row.status === "dismissed" ? "Dismissed — not posted" : "Awaiting verification — not posted"}</span></div>
          <p className="break-all">{row.sourceName} · Transaction {row.transactionReference}</p><p>{when(row.observedAt)} WAT</p>{row.note && <p>{row.note}</p>}
          {row.dismissalReason && <p>Dismissal reason: {row.dismissalReason}</p>}
          {row.status === "needs_verification" && <button className="text-sm font-semibold text-emerald-800 underline" disabled={busy} onClick={() => { setDismissId(row.id); setReason(""); }}>Review dismissal</button>}
          {dismissId === row.id && <div className="space-y-2 rounded-lg bg-slate-50 p-3"><label>Why is this report incorrect or not applicable?<textarea className={input} value={reason} maxLength={500} onChange={e => setReason(e.target.value)} disabled={busy} /></label><div className="flex gap-3"><button className={button} disabled={busy || reason.trim().length < 5} onClick={() => void dismiss()}>Dismiss report only</button><button disabled={busy} onClick={() => setDismissId(null)}>Cancel</button></div></div>}
        </li>)}</ul>}
        {detail.installments.length > 0 && !["cancelled", "rejected", "pending_approval"].includes(loan?.orderStatus ?? "") && <details className="rounded-xl border p-4"><summary className="cursor-pointer font-semibold">Record a payment for verification</summary>
          <p className="my-3 text-sm text-slate-600">Use a transaction or statement reference from Recova or your receiving bank. Do not enter BVNs, full account numbers, PINs or credentials. Saving this report does not confirm receipt or reduce the balance.</p>
          <form className="grid gap-3 sm:grid-cols-2" onSubmit={event => void report(event)}>
            <label className="text-sm">Reported payment type<select className={input} name="channel" disabled={busy}><option value="collection">Recova collection</option><option value="recovery">Recova recovery</option><option value="voluntary">Voluntary payment</option></select></label>
            <label className="text-sm">Source / provider name<input className={input} name="sourceName" placeholder="Recova or receiving bank name" required minLength={2} maxLength={80} disabled={busy} /></label>
            <label className="text-sm">Transaction reference<input className={input} name="transactionReference" required minLength={3} maxLength={120} disabled={busy} /></label>
            <label className="text-sm">Reported amount (₦)<input className={input} name="amountNaira" inputMode="decimal" placeholder="22000.00" required pattern="[0-9]+(\.[0-9]{1,2})?" disabled={busy} /></label>
            <label className="text-sm">Payment date and time (your device time)<input className={input} name="observedAt" type="datetime-local" required disabled={busy} /></label>
            <label className="text-sm">Evidence note (optional)<textarea className={input} name="note" maxLength={500} disabled={busy} /></label>
            <div className="sm:col-span-2"><button className={button} disabled={busy}>{busy ? "Saving…" : "Save unverified report"}</button></div>
          </form>
        </details>}
      </>}
    </section>}
  </Card>;
}
