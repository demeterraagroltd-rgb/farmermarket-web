"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Card } from "../ui/Card";
import { accountFetch, readError } from "../../lib/customer";
import { formatDate, formatNairaAmount } from "../../lib/format";
import { RECOVA_BANKS } from "../../lib/recova-banks";

type Setup = {
  setup: { draftAvailable: boolean; submissionEnabled: boolean; purpose: "Collection" | "Recovery" };
  eligible: boolean;
  consent: null | { reference: string; status: string; purpose: string; accountLast4: string; bankCode: string;
    approvalUrl: string | null; schedule: { dueDate: string; amount: number }[]; checkedAt: string | null };
};
const labels: Record<string, string> = { draft: "Prepared — not sent", submitting: "Confirming request", awaiting_consent: "Waiting for your approval",
  processing: "Mandate processing", active: "Mandate active", failed: "Mandate rejected", needs_review: "Request needs support review", cancelled: "Mandate cancelled", expired: "Mandate expired" };

export function RecovaRepaymentCard({ orderId }: { orderId: string }) {
  const [data, setData] = useState<Setup | null>(null);
  const [bankCode, setBankCode] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [pin, setPin] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [owned, setOwned] = useState(false);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const path = `/v1/orders/${encodeURIComponent(orderId)}/recova`;
  const load = useCallback(async () => {
    try {
      const response = await accountFetch(path, { cache: "no-store" });
      if (!response.ok) throw new Error(await readError(response));
      setData(await response.json()); setError(null);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not load repayment setup."); }
  }, [path]);
  useEffect(() => { void load(); }, [load]);

  async function action(name: "prepare" | "submit" | "refresh", event?: FormEvent) {
    event?.preventDefault();
    setBusy(true); setError(null);
    try {
      const response = await accountFetch(`${path}/${name}`, { method: "POST", body: name === "refresh" ? undefined : JSON.stringify(name === "prepare"
        ? { txnPin: pin, bankCode, accountNumber, accountOwnedByCustomer: owned, consentAccepted: accepted } : { txnPin: pin }) });
      if (!response.ok) throw new Error(await readError(response));
      setData(await response.json()); setPin("");
      if (name === "prepare") { setAccountNumber(""); setAccepted(false); setOwned(false); setEditing(false); }
    } catch (e) { setError(e instanceof Error ? e.message : "Could not update repayment setup."); }
    finally { setBusy(false); }
  }

  const input = "mt-1 w-full rounded-lg border border-dark-border px-3 py-2 text-sm";
  const button = "rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white disabled:opacity-40";
  const consent = data?.consent;
  const done = consent?.status === "active";
  return <Card className="mt-6 space-y-4 p-5">
    <h2 className="font-semibold text-text-dark">{done ? "Repayment set up with Recova" : "Set up repayment with Recova"}</h2>
    {!done && <p className="text-sm text-text-medium">Authorize repayment for this order through Recova. Your existing bank connection does not replace this authorization.</p>}
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    {error?.toLowerCase().includes("bvn") && <a href="/account#bvn-verification" className="inline-block text-sm font-semibold text-primary underline">Re-enter your BVN in your account</a>}
    {!data && <button className={button} disabled={busy} onClick={() => void load()}>Load repayment setup</button>}
    {data && !data.eligible && <p className="text-sm text-text-muted">Repayment setup isn't available for this order.</p>}
    {data?.eligible && !done && <p className="text-sm font-semibold text-text-dark">Set this up now: we approve your order once your repayment mandate is active.</p>}
    {consent && <div className="space-y-2 rounded-lg bg-slate-50 p-3 text-sm">
      <p className="font-semibold">{labels[consent.status] ?? "Awaiting verification"}</p>
      <p>Purpose: {consent.purpose} · {RECOVA_BANKS.find(bank => bank.code === consent.bankCode)?.name ?? "Bank account"} · Account ending {consent.accountLast4}</p>
      <p className="break-all text-xs">Loan reference: {consent.reference}</p>
      <ul>{consent.schedule.map(row => <li key={row.dueDate}>{formatDate(row.dueDate)}: {formatNairaAmount(row.amount)}</li>)}</ul>
      {consent.approvalUrl && !done && <a className="inline-block font-semibold text-primary underline" href={consent.approvalUrl} target="_blank" rel="noopener noreferrer">Continue authorization on Recova</a>}
      {consent.status === "needs_review" && <p>We could not confirm the request outcome. Contact support with your loan reference. Do not start another request.</p>}
      {done && <p>You're all set for this order. Recova has confirmed your mandate, so there is nothing more to do. Repayments will be collected on the dates above.</p>}
      {consent.status !== "draft" && !done && <button className={button} disabled={busy} onClick={() => void action("refresh")}>Check authorization status</button>}
    </div>}
    {data?.eligible && (!consent || consent.status === "draft") && <>
      {(!consent || editing) && (!data.setup.draftAvailable ? <p className="text-sm text-text-muted">Repayment setup is being configured. Please contact support.</p> : <form onSubmit={event => void action("prepare", event)} className="space-y-3">
        <p className="text-sm text-text-medium">Prepare your bank details first. This saves a draft and sends nothing to Recova.</p>
        <label className="block text-sm">Bank name<select className={input} value={bankCode} onChange={e => setBankCode(e.target.value)} required disabled={busy}>
          <option value="" disabled>Select your bank</option>
          {RECOVA_BANKS.map(bank => <option key={bank.code} value={bank.code}>{bank.name}</option>)}
        </select></label>
        <p className="text-xs text-text-muted">If your bank is not listed, contact support before continuing.</p>
        <label className="block text-sm">Your 10-digit account number<input className={input} value={accountNumber} onChange={e => setAccountNumber(e.target.value.replace(/\D/g, "").slice(0, 10))} inputMode="numeric" pattern="[0-9]{10}" required autoComplete="off" /></label>
        <label className="block text-sm">Transaction code<input className={input} type="password" value={pin} onChange={e => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))} inputMode="numeric" pattern="[0-9]{4}" required autoComplete="off" /></label>
        <label className="flex gap-2 text-sm"><input type="checkbox" checked={owned} onChange={e => setOwned(e.target.checked)} required />This account belongs to me.</label>
        <label className="flex gap-2 text-sm"><input type="checkbox" checked={accepted} onChange={e => setAccepted(e.target.checked)} required />I agree to share my verified BVN, contact details, repayment account and this order’s repayment schedule with Recova to request {data.setup.purpose.toLowerCase()} authorization. I will review the mandate terms on Recova before approving.</label>
        <button className={button} disabled={busy || !accepted || !owned}>Prepare repayment setup</button>
        {consent && <button type="button" className="ml-3 text-sm font-semibold text-primary underline" disabled={busy} onClick={() => { setEditing(false); setPin(""); setAccountNumber(""); setAccepted(false); setOwned(false); }}>Cancel changes</button>}
      </form>)}
      {consent?.status === "draft" && !editing && <div className="space-y-3 border-t pt-3">
        {!data.setup.submissionEnabled ? <div role="status" className="space-y-2 rounded-lg bg-emerald-50 p-4 text-sm">
          <p className="font-semibold text-emerald-900">Your repayment details are saved</p>
          <p>There is nothing else for you to submit right now. Farmer Market must activate live Recova authorization before you can continue.</p>
          <p>No request has been sent to Recova, no mandate is active from this setup, and no money has been debited by this setup.</p>
          <p>Once live authorization is available, return here and send the authorization request. You will then receive a Recova link to review and approve the mandate.</p>
          <button type="button" className="font-semibold text-primary underline" disabled={busy} onClick={() => void load()}>Check if authorization is available</button>
        </div>
          : <form onSubmit={event => void action("submit", event)} className="space-y-3">
            <p className="text-sm">Sending this request shares the prepared details with Recova. Approving their mandate may authorize scheduled debits under the terms shown there.</p>
            <label className="block text-sm">Confirm your transaction code<input className={input} type="password" value={pin} onChange={e => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))} inputMode="numeric" pattern="[0-9]{4}" required autoComplete="off" /></label>
            <button className={button} disabled={busy}>Send authorization request to Recova</button>
          </form>}
        <button type="button" className="text-sm font-semibold text-primary underline" disabled={busy} onClick={() => { setBankCode(consent.bankCode); setPin(""); setEditing(true); }}>Edit saved bank details</button>
      </div>}
    </>}
    {busy && <p role="status" className="text-sm">Updating repayment setup…</p>}
  </Card>;
}
