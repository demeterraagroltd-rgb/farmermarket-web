"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "../../lib/auth";
import { Card } from "../ui/Card";

type Journey = {
  started: boolean; steps: string[]; completedSteps?: number; complete?: boolean; nextStep?: string;
  customer?: { name: string }; application?: { reference: string; status: string };
  credit?: { limitNaira: number; usedNaira: number }; order?: { status: string; totalNaira: number };
  mandate?: string; accounting?: { repaymentCount: number; receivedNaira: number; ledgerBalanced: boolean };
  installments?: Array<{ number: number; dueDate: string; amountNaira: number; paidNaira: number; isPaid: boolean }>;
  events?: Array<{ title: string; detail: string; source: string; at: string }>;
  policy?: { stage: string; outstandingKobo: number; collectionTargetKobo: number; recoveryTargetKobo: number };
};
const money = (naira: number) => new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN" }).format(naira);
const button = "rounded-lg bg-emerald-800 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40";

export function RecovaJourney() {
  const [journey, setJourney] = useState<Journey | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function request(action?: "start" | "next" | "run") {
    setBusy(true); setError(null);
    try {
      const response = await apiFetch(`/v1/admin/recova/sandbox/journey${action ? `/${action}` : ""}`, action ? { method: "POST" } : {});
      const body = await response.json();
      if (!response.ok) throw new Error(body.message ?? "The practice journey could not load.");
      setJourney(body);
    } catch (e) { setError(e instanceof Error ? e.message : "Request failed"); }
    finally { setBusy(false); }
  }
  useEffect(() => { void request(); }, []);

  return <Card className="space-y-5 p-6">
    <div><p className="text-xs font-semibold uppercase tracking-wider text-emerald-700">Start here · complete practice journey</p>
      <h2 className="mt-2 text-xl font-bold">From application to recovered balance</h2>
      <p className="mt-2 text-sm text-slate-600">Create one test customer and food order, then walk through credit approval, mandate authorisation, collection, a missed payment and recovery.</p>
    </div>
    <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
      Farmer Market&apos;s application, checkout, approval, fulfilment and repayment services run against an isolated temporary database.
      Bank consent and collection/recovery results are simulated. This journey sends no requests to Recova and changes no real customer accounts.
    </p>
    {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>}
    <div className="flex flex-wrap gap-3">
      <button className={button} disabled={busy} onClick={() => void request("start")}>{journey?.started ? "Start another practice journey" : "Create test customer and start"}</button>
      {journey?.started && !journey.complete && <>
        <button className={button} disabled={busy} onClick={() => void request("next")}>Next: {journey.nextStep}</button>
        <button className="rounded-lg border border-emerald-800 px-4 py-2 text-sm font-semibold text-emerald-900 disabled:opacity-40" disabled={busy} onClick={() => void request("run")}>Run all remaining steps</button>
      </>}
      <button className="rounded-lg border px-4 py-2 text-sm disabled:opacity-40" disabled={busy} onClick={() => void request()}>Refresh journey</button>
    </div>
    {busy && <p role="status" className="text-sm text-slate-600">Running the practice workflow. Preparing the isolated database can take a moment…</p>}
    {journey?.started && <>
      <div className="grid gap-3 rounded-xl bg-emerald-50 p-4 text-sm sm:grid-cols-2 lg:grid-cols-3">
        <div><p className="text-slate-600">Customer</p><p className="font-semibold">{journey.customer?.name}</p></div>
        <div><p className="text-slate-600">Application</p><p className="font-semibold">{journey.application ? `${journey.application.reference} · ${journey.application.status.replaceAll("_", " ")}` : "Not submitted yet"}</p></div>
        <div><p className="text-slate-600">Order</p><p className="font-semibold">{journey.order ? `${money(journey.order.totalNaira)} · ${journey.order.status.replaceAll("_", " ")}` : "Not placed yet"}</p></div>
        <div><p className="text-slate-600">Test credit used</p><p className="font-semibold">{money(journey.credit?.usedNaira ?? 0)}</p></div>
        <div><p className="text-slate-600">Remaining scheduled debt</p><p className="font-semibold">{money((journey.policy?.outstandingKobo ?? 0) / 100)}</p></div>
        <div><p className="text-slate-600">Practice repayments recorded</p><p className="font-semibold">{money(journey.accounting?.receivedNaira ?? 0)}</p></div>
      </div>
      <div className="flex flex-wrap gap-4 text-sm"><span>Practice mandate: <strong>{journey.mandate}</strong></span><span>Ledger: <strong>{journey.accounting?.ledgerBalanced ? "balanced" : "needs review"}</strong></span><span>Current stage: <strong>{journey.policy?.stage ?? "application"}</strong></span></div>
      {!!journey.installments?.length && <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="border-b"><th className="p-2">Instalment</th><th className="p-2">Due date (Nigeria)</th><th className="p-2">Scheduled</th><th className="p-2">Received</th><th className="p-2">Status</th></tr></thead><tbody>
        {journey.installments.map((row) => <tr key={row.number} className="border-b"><td className="p-2">{row.number}</td><td className="p-2">{new Date(row.dueDate).toLocaleDateString("en-GB", { timeZone: "Africa/Lagos" })}</td><td className="p-2">{money(row.amountNaira)}</td><td className="p-2">{money(row.paidNaira)}</td><td className="p-2">{row.isPaid ? "Paid" : row.paidNaira ? "Part paid" : "Unpaid"}</td></tr>)}
      </tbody></table></div>}
      <ol className="space-y-3" aria-label="Practice journey progress">
        {journey.steps.map((title, index) => {
          const event = journey.events?.[index];
          return <li key={title} className={`rounded-xl border p-4 ${event ? "border-emerald-200 bg-emerald-50/50" : "border-slate-200"}`}>
            <p className="font-semibold">{event ? "✓" : index + 1}. {title}</p>
            {event ? <><p className={`mt-1 text-xs font-semibold ${event.source === "Simulated bank outcome" ? "text-amber-800" : "text-emerald-800"}`}>{event.source}</p><p className="mt-2 text-sm text-slate-700">{event.detail}</p></> : <p className="mt-1 text-sm text-slate-500">{index === journey.completedSteps ? "Next step" : "Waiting"}</p>}
          </li>;
        })}
      </ol>
      {journey.complete && <p className="rounded-lg bg-emerald-900 p-4 text-sm font-semibold text-white">Practice complete: all installments are paid, the outstanding balance is zero and the test credit is restored. Actual Recova consent, callbacks and bank sweeps still need provider testing.</p>}
    </>}
    <p className="text-xs text-slate-500">Practice records appear only in this guided journey, not the real customer or order queues. Restarting the API clears them.</p>
  </Card>;
}
