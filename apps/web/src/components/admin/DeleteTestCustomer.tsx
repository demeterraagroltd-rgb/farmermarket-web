"use client";
import { useEffect, useState } from "react";
import { apiFetch } from "../../lib/auth";
import { formatNaira } from "../../lib/format";

type Preview = { id: string; name: string; allowed: boolean; blockers: string[]; orders: number; repaymentSchedules: number;
  applications: number; recovaDrafts: number; outstandingKobo: string; confirmation: string; retained: string };

export function DeleteTestCustomer({ id, onClose, onDeleted }: { id: string; onClose: () => void; onDeleted: () => void }) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [reason, setReason] = useState("");
  const [confirmedTest, setConfirmedTest] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let mounted = true;
    void apiFetch(`/v1/admin/customers/${id}/test-deletion-preview`, { cache: "no-store" }).then(async res => {
      const body = await res.json();
      if (!res.ok) throw new Error(body.message ?? "Unable to review deletion");
      if (mounted) setPreview(body);
    }).catch(e => { if (mounted) setError(e instanceof Error ? e.message : "Unable to review deletion"); });
    return () => { mounted = false; };
  }, [id]);
  async function remove() {
    if (!preview?.allowed || confirmation !== preview.confirmation || !confirmedTest || !reason.trim()) return;
    setBusy(true); setError(null);
    try {
      const res = await apiFetch(`/v1/admin/customers/${id}/delete-test-account`, { method: "POST",
        body: JSON.stringify({ confirmation, reason: reason.trim(), testDataConfirmed: confirmedTest }) });
      const body = await res.json();
      if (!res.ok) throw new Error(body.message ?? "Deletion failed");
      onDeleted();
    } catch (e) { setError(e instanceof Error ? e.message : "Deletion failed"); }
    finally { setBusy(false); }
  }
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
    <section role="dialog" aria-modal="true" aria-labelledby="delete-test-title" className="max-h-[90vh] w-full max-w-xl space-y-4 overflow-auto rounded-xl bg-white p-6 shadow-xl">
      <h2 id="delete-test-title" className="text-lg font-bold">Permanently delete test account{preview ? `: ${preview.name}` : ""}</h2>
      <p className="rounded-lg bg-red-50 p-3 text-sm text-red-900">This cannot be undone. Use only for confirmed test data. The account, login details, identity and bank records, test applications, orders, unpaid schedules and unsubmitted Recova drafts will be removed. The customer can register again.</p>
      {!preview && !error && <p role="status">Reviewing linked records…</p>}
      {preview && <>
        <dl className="grid grid-cols-2 gap-2 rounded-lg bg-slate-50 p-3 text-sm">
          <dt>Test orders</dt><dd>{preview.orders}</dd>
          <dt>Repayment schedules</dt><dd>{preview.repaymentSchedules}</dd>
          <dt>Unpaid test balance removed</dt><dd>{formatNaira(preview.outstandingKobo)}</dd>
          <dt>Credit applications</dt><dd>{preview.applications}</dd>
          <dt>Unsubmitted Recova drafts</dt><dd>{preview.recovaDrafts}</dd>
        </dl>
        <p className="text-sm text-slate-600">Reserved stock is released. {preview.retained}</p>
        {!preview.allowed && <ul className="list-disc space-y-1 rounded-lg bg-amber-50 p-4 pl-8 text-sm text-amber-900">{preview.blockers.map(message => <li key={message}>{message}</li>)}</ul>}
        {preview.allowed && <>
          <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={confirmedTest} disabled={busy} onChange={e => setConfirmedTest(e.target.checked)} />I confirm this account and its unpaid orders are test data, with no real debt or money movement to retain.</label>
          <label className="block text-sm">Deletion reason<textarea className="mt-1 block w-full rounded-lg border p-2" value={reason} maxLength={500} disabled={busy} onChange={e => setReason(e.target.value)} /></label>
          <label className="block text-sm">Type <code className="break-all font-semibold">{preview.confirmation}</code> to confirm<input autoComplete="off" className="mt-1 block w-full rounded-lg border p-2" value={confirmation} disabled={busy} onChange={e => setConfirmation(e.target.value)} /></label>
        </>}
      </>}
      {error && <p role="alert" className="text-sm text-red-800">{error}</p>}
      <div className="flex flex-wrap justify-end gap-3">
        <button className="rounded-lg border px-4 py-2" disabled={busy} onClick={onClose}>Cancel</button>
        <button className="rounded-lg bg-red-700 px-4 py-2 font-semibold text-white disabled:opacity-40" disabled={busy || !preview?.allowed || confirmation !== preview.confirmation || !confirmedTest || !reason.trim()} onClick={() => void remove()}>{busy ? "Deleting…" : "Permanently delete test account"}</button>
      </div>
    </section>
  </div>;
}
