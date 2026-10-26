"use client";

export type RecovaReadinessReport = {
  checkedAt: string;
  fullyOperational: boolean;
  summary: string;
  checks: { id: string; group: string; title: string; state: "configured" | "missing" | "blocked" | "unverified"; detail: string; nextStep: string; owner: string }[];
  webhooks: { title: string; path: string }[];
};
const presentation = {
  configured: { label: "Configured", style: "border-emerald-200 bg-emerald-50 text-emerald-900", icon: "✓" },
  missing: { label: "Needs setup", style: "border-rose-200 bg-rose-50 text-rose-900", icon: "!" },
  blocked: { label: "Blocked", style: "border-amber-200 bg-amber-50 text-amber-900", icon: "!" },
  unverified: { label: "Not verified", style: "border-slate-200 bg-slate-100 text-slate-700", icon: "○" },
};
export function RecovaReadiness({ report }: { report: RecovaReadinessReport }) {
  const groups = [...new Set(report.checks.map(check => check.group))];
  const apiBase = process.env.NEXT_PUBLIC_API_URL?.replace(/\/+$/, "") ?? "";
  return <section aria-labelledby="recova-readiness-heading" className="space-y-5">
    <div className="rounded-xl border border-amber-200 bg-amber-50 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 id="recova-readiness-heading" className="text-lg font-bold text-slate-900">Farmer Market repayment readiness</h3>
        <span className="rounded-full border border-amber-300 bg-white px-3 py-1 text-sm font-semibold text-amber-900">Not ready for full launch</span>
      </div>
      <p className="mt-2 text-sm text-slate-700">{report.summary}</p>
      <p className="mt-2 text-xs text-slate-600">Checked {new Date(report.checkedAt).toLocaleString()}. This check reads server settings only. It does not send messages, request authorization or debit an account.</p>
    </div>
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="Readiness counts">
      {(Object.keys(presentation) as (keyof typeof presentation)[]).map(state => <div key={state} className={`rounded-xl border p-4 ${presentation[state].style}`}>
        <p className="text-2xl font-bold">{report.checks.filter(check => check.state === state).length}</p><p className="text-sm">{presentation[state].label}</p>
      </div>)}
    </div>
    <p className="text-sm text-slate-600"><strong>Configured</strong> means a server setting is present. <strong>Not verified</strong> needs a real test or provider confirmation. <strong>Needs setup</strong> is missing configuration. <strong>Blocked</strong> needs prerequisites or implementation before use.</p>
    {groups.map(group => <div key={group} className="overflow-hidden rounded-xl border border-slate-200">
      <h4 className="bg-slate-50 px-4 py-3 font-semibold text-slate-900">{group}</h4>
      <ul className="divide-y divide-slate-200">
        {report.checks.filter(check => check.group === group).map(check => {
          const badge = presentation[check.state];
          return <li key={check.id} className="p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <p className="font-semibold text-slate-900">{check.title}</p>
              <span className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-semibold ${badge.style}`}><span aria-hidden="true">{badge.icon}</span>{badge.label}</span>
            </div>
            <p className="mt-2 text-sm text-slate-600">{check.detail}</p>
            {check.state !== "configured" && <>
              <p className="mt-2 text-sm text-slate-900"><strong>Next step:</strong> {check.nextStep}</p>
              <p className="mt-1 text-xs text-slate-500">Responsible: {check.owner}</p>
            </>}
          </li>;
        })}
      </ul>
    </div>)}
    <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
      <h4 className="font-semibold text-slate-900">Webhook details for Recova</h4>
      <p className="text-sm text-slate-600">Give Recova these URLs for this API environment. Registration and successful delivery still need confirmation. The mandate-created callback is not proof of payment or disbursement.</p>
      {report.webhooks.map(webhook => <div key={webhook.path}>
        <p className="text-sm font-semibold">{webhook.title} · POST</p>
        <code className="mt-1 block break-all rounded-lg border border-slate-200 bg-white p-3 text-xs">{apiBase}{webhook.path}</code>
      </div>)}
      <p className="text-sm text-slate-600">Proposed authentication header: <code>x-recova-webhook-secret</code>. Recova must agree to support it. Exchange the secret privately; it is not displayed here.</p>
    </div>
  </section>;
}
