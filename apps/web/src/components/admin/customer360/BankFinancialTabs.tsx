"use client";

import { Badge } from "../../ui/Badge";
import { Button } from "../../ui/Button";
import { Card } from "../../ui/Card";
import { formatDate, formatDateTime, formatNaira } from "../../../lib/format";
import {
  ACCOUNT_STATUS_LABEL,
  ACCOUNT_STATUS_TONE,
  SYNC_STATUS_TONE,
  SYNC_TRIGGER_LABEL,
  timeAgo,
} from "../../../lib/customer360";
import { BankAnalysisView } from "../kyc-review";
import { DataTable, Row, Section, FreshnessBadge, NotStoredYet, Td, Updated, type TabProps } from "./parts";
import { useBankRefresh } from "./useBankRefresh";

// ── Bank accounts ─────────────────────────────────────────────────────────

export function BankTab({ data, reload, goTab }: TabProps) {
  const { bank, customer } = data;
  const { refresh, busy, message } = useBankRefresh(customer.id, reload);

  if (bank.accounts.length === 0) {
    return (
      <div className="max-w-xl">
        <Section
          title="No bank account linked"
          description="Bank linking is requested by a credit officer, then completed by the customer from their own account page."
        >
          {/* The existing request control — one implementation of "ask the customer to link". */}
          <BankAnalysisView
            userId={customer.id}
            analysis={null}
            linkedAt={null}
            requestedAt={bank.requestedAt}
            onRequested={reload}
          />
        </Section>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {bank.accounts.map((a) => (
        <Section
          key={a.monoAccountId}
          title={a.bankName ?? "Bank account"}
          description={a.accountName ?? undefined}
          action={
            <Button variant="secondary" onClick={refresh} disabled={busy}>
              {busy ? "Refreshing…" : "Refresh account information"}
            </Button>
          }
        >
          <div className="grid gap-x-8 sm:grid-cols-2">
            <div>
              <Row label="Account number" value={a.accountMasked} mono />
              <Row label="Account holder" value={a.accountName} origin="bank" />
              <Row label="Currency" value={a.currency} />
              <Row label="Balance" value={a.balanceKobo == null ? null : formatNaira(a.balanceKobo)} origin="bank" />
            </div>
            <div>
              <Row
                label="Connection"
                value={<Badge tone={ACCOUNT_STATUS_TONE[a.status]}>{ACCOUNT_STATUS_LABEL[a.status]}</Badge>}
              />
              <Row label="Linked" value={a.linkedAt ? formatDate(a.linkedAt) : null} />
              <Row
                label="Last sync"
                value={
                  a.lastSyncAt ? (
                    <span className="flex items-center gap-2">
                      <Updated at={a.lastSyncAt} prefix="" /> <FreshnessBadge freshness={a.freshness} />
                    </span>
                  ) : null
                }
              />
              <Row label="Mono account ID" value={a.monoAccountId} mono />
            </div>
          </div>
          <div className="mt-4 flex flex-wrap gap-2 border-t border-dark-border/60 pt-4">
            <Button variant="ghost" onClick={() => goTab("transactions")}>
              View transactions
            </Button>
            <Button variant="ghost" onClick={() => goTab("financial")}>
              View income
            </Button>
            <Button variant="ghost" onClick={() => goTab("statements")}>
              View statement
            </Button>
            <Button variant="ghost" onClick={() => goTab("financial")}>
              View financial analysis
            </Button>
          </div>
          {message && (
            <p className={`mt-3 text-xs ${message.tone === "ok" ? "text-primary" : "text-error"}`}>{message.text}</p>
          )}
          <p className="mt-3 text-xs text-text-muted">
            The customer&apos;s consent stays valid until they revoke it, so there&apos;s no need to ask them to link
            again — refreshing pulls fresh data over the existing connection.
          </p>
        </Section>
      ))}

      <Section
        title="Sync history"
        description="Every attempt to reach Mono for this customer, failures included — the answer to “why is this data stale?”"
      >
        {bank.syncHistory.length === 0 ? (
          <p className="text-sm text-text-muted">
            No syncs recorded yet. Data linked before sync logging began shows here from its next refresh.
          </p>
        ) : (
          <DataTable head={["When", "Trigger", "Result", "Transactions", "Took", "Detail"]}>
            {bank.syncHistory.map((s) => (
              <tr key={s.id}>
                <Td className="whitespace-nowrap text-text-medium" >
                  <span title={formatDateTime(s.startedAt)}>{timeAgo(s.startedAt)}</span>
                </Td>
                <Td className="text-text-dark">
                  {SYNC_TRIGGER_LABEL[s.trigger]}
                  {s.triggeredBy && <span className="text-text-muted"> · {s.triggeredBy}</span>}
                </Td>
                <Td>
                  <Badge tone={SYNC_STATUS_TONE[s.status]}>{s.status}</Badge>
                </Td>
                <Td className="tabular-nums text-text-medium">
                  {s.transactionsFetched} fetched · {s.transactionsInserted} new
                </Td>
                <Td className="tabular-nums text-text-muted">
                  {s.durationMs == null ? "—" : `${(s.durationMs / 1000).toFixed(1)}s`}
                </Td>
                <Td className="max-w-[280px] text-xs text-error">{s.error ?? ""}</Td>
              </tr>
            ))}
          </DataTable>
        )}
      </Section>
    </div>
  );
}

// ── Income & financial analysis ───────────────────────────────────────────

function Metric({ label, children, sub }: { label: string; children: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <Card className="px-4 py-3.5">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">{label}</p>
      <div className="mt-1.5 text-xl font-bold tabular-nums text-text-dark">{children}</div>
      {sub && <div className="mt-1 text-xs text-text-muted">{sub}</div>}
    </Card>
  );
}
const NONE = <span className="text-base font-medium text-text-muted">—</span>;

const SOURCE_LABEL = { income_api: "Mono Income", statement: "Statement analysis", unavailable: "Unavailable" } as const;
const REG_LABEL = { regular: "Regular", partial: "Partial", irregular: "Irregular" } as const;
const REG_TONE = { regular: "success", partial: "warning", irregular: "error" } as const;
const CONF_TONE = { high: "success", medium: "warning", low: "error" } as const;
const BAND: Record<string, { label: string; tone: "success" | "warning" | "error" | "neutral" }> = {
  matches: { label: "Matches declared", tone: "success" },
  moderate: { label: "Differs moderately", tone: "warning" },
  large: { label: "Differs a lot", tone: "error" },
  unknown: { label: "Can't compare", tone: "neutral" },
};

/** Two bars on one scale — declared against what the bank shows. */
function IncomeBars({ declared, estimated }: { declared: number | null; estimated: number | null }) {
  const max = Math.max(declared ?? 0, estimated ?? 0);
  if (!max) return null;
  const bar = (label: string, value: number | null, color: string) => (
    <div className="grid grid-cols-[110px_1fr_110px] items-center gap-3 text-sm">
      <span className="text-text-muted">{label}</span>
      <div className="h-3 overflow-hidden rounded-full bg-surface">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${value ? Math.max(2, (value / max) * 100) : 0}%` }} />
      </div>
      <span className="text-right tabular-nums text-text-dark">{value == null ? "—" : formatNaira(value)}</span>
    </div>
  );
  return (
    <div className="flex flex-col gap-2.5">
      {bar("Declared", declared, "bg-gold")}
      {bar("Bank shows", estimated, "bg-primary")}
    </div>
  );
}

export function FinancialTab({ data, reload }: TabProps) {
  const f = data.financial;
  const { refresh, busy, message } = useBankRefresh(data.customer.id, reload);
  const connected = data.bank.state === "connected";

  if (!f.analysis || f.source === "unavailable") {
    return (
      <NotStoredYet title={connected ? "No usable income data yet" : "No bank data to analyse"}>
        {connected
          ? "The bank is linked but Mono hasn't returned income or transaction data yet. Refresh from the Bank Accounts tab, or wait for Mono to finish processing the account."
          : "Income analysis comes from the customer's linked bank account. Request one from the Bank Accounts tab."}
      </NotStoredYet>
    );
  }

  const inc = f.income;
  const band = BAND[inc.band];
  const diffPct = inc.divergence == null ? null : Math.round(inc.divergence * 100);
  const sign = inc.differenceKobo != null && inc.differenceKobo > 0 ? "+" : "";

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2 text-sm text-text-medium">
          <span>Source:</span>
          <Badge tone="info">{SOURCE_LABEL[f.source ?? "unavailable"]}</Badge>
          <span className="text-text-muted">·</span>
          <Updated at={f.retrievedAt} />
          <FreshnessBadge freshness={f.freshness} />
        </div>
        <Button variant="secondary" onClick={refresh} disabled={busy || !connected}>
          {busy ? "Refreshing…" : "Refresh financial data"}
        </Button>
      </div>
      {message && <p className={`text-xs ${message.tone === "ok" ? "text-primary" : "text-error"}`}>{message.text}</p>}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Metric label="Salary detected">
          {f.salaryDetected == null ? NONE : <Badge tone={f.salaryDetected ? "success" : "warning"}>{f.salaryDetected ? "Yes" : "No"}</Badge>}
        </Metric>
        <Metric label="Est. monthly income">{inc.estimatedKobo == null ? NONE : formatNaira(inc.estimatedKobo)}</Metric>
        <Metric label="Declared income">{inc.declaredKobo == null ? NONE : formatNaira(inc.declaredKobo)}</Metric>
        <Metric
          label="Income difference"
          sub={<Badge tone={band.tone}>{band.label}</Badge>}
        >
          {inc.differenceKobo == null ? NONE : (
            <>
              {sign}
              {formatNaira(inc.differenceKobo)} <span className="text-sm font-medium text-text-muted">({diffPct}%)</span>
            </>
          )}
        </Metric>
        <Metric label="Employer match">
          {f.employerMatch == null ? NONE : <Badge tone={f.employerMatch ? "success" : "error"}>{f.employerMatch ? "Matched" : "Not matched"}</Badge>}
        </Metric>
        <Metric label="Income regularity">
          {f.regularity ? <Badge tone={REG_TONE[f.regularity]}>{REG_LABEL[f.regularity]}</Badge> : NONE}
        </Metric>
        <Metric label="Confidence">
          {f.confidence ? <Badge tone={CONF_TONE[f.confidence]}>{f.confidence[0].toUpperCase() + f.confidence.slice(1)}</Badge> : NONE}
        </Metric>
        <Metric label="Months of data">{f.monthsAnalysed || NONE}</Metric>
      </div>

      <Section title="Declared vs. bank" description="Both on the same scale, monthly.">
        <IncomeBars declared={inc.declaredKobo} estimated={inc.estimatedKobo} />
      </Section>

      <Section
        title="Income sources"
        description="Salary and other recurring income, broken out by payer."
      >
        <NotStoredYet title="Needs stored transactions">
          Income sources and recurring income are worked out from individual transactions. Those aren&apos;t stored yet —
          today only the summary above is kept. This section fills in once transaction storage is added.
        </NotStoredYet>
      </Section>

      <p className="text-xs text-text-muted">
        Figures are analytical estimates from the bank data Mono returned, not verified statements of earnings.
        {data.bank.accounts[0]?.linkedAt && ` Account linked ${formatDate(data.bank.accounts[0].linkedAt)}.`}
      </p>
    </div>
  );
}
