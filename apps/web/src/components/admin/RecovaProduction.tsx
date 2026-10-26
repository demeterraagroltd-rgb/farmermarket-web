"use client";

import { useState } from "react";
import { apiFetch } from "../../lib/auth";
import { Card } from "../ui/Card";

type Status = { enabled: boolean; tokenConfigured: boolean; configurationReady: boolean; destination: string | null; institutionCode: string | null; issues: string[];
  customerSetup?: { draftAvailable: boolean; submissionEnabled: boolean; issues: string[] } };
export function RecovaProduction() {
  const [status, setStatus] = useState<Status | null>(null);
  const [reference, setReference] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<unknown>(null);
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
  const button = "rounded-lg bg-emerald-800 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40";
  return <Card className="space-y-4 p-6">
    <h2 className="text-xl font-bold">Recova production connection</h2>
    <p className="text-sm text-slate-600">Connect using the production URL and token stored on the API server. This section reads consent and mandate records. It does not create mandates, collect money or trigger recovery.</p>
    <button className={button} disabled={busy} onClick={() => void check("status")}>Check production configuration</button>
    {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>}
    {status && <div className="space-y-2 rounded-lg bg-slate-50 p-4 text-sm">
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
    <label className="block text-sm">Production loan reference
      <input className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" value={reference} disabled={busy} autoComplete="off" onChange={(e) => setReference(e.target.value)} placeholder="Reference supplied by Recova or an existing production loan" />
    </label>
    <div className="flex flex-wrap gap-3">
      <button className={button} disabled={busy || !status?.configurationReady || !reference.trim()} onClick={() => void check(`mandate/${encodeURIComponent(reference.trim())}`)}>Read production mandate</button>
      <button className={button} disabled={busy || !status?.configurationReady || !reference.trim()} onClick={() => void check(`consent/${encodeURIComponent(reference.trim())}`)}>Read production consent</button>
    </div>
    {busy && <p role="status" className="text-sm text-slate-500">Checking…</p>}
    {result !== null && <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-slate-950 p-4 text-xs text-slate-100">{JSON.stringify(result, null, 2)}</pre>}
  </Card>;
}
