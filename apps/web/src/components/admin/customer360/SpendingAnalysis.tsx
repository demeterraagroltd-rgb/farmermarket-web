"use client";

import { Badge } from "../../ui/Badge";
import { formatDate, formatNaira } from "../../../lib/format";
import {
  CATEGORY_COLOR,
  CATEGORY_LABEL,
  TREND_LABEL,
  TREND_TONE,
  type CategorySignal,
  type SpendingAnalysis as SpendingAnalysisData,
} from "../../../lib/customer360";
import { DataTable, Section, Td } from "./parts";
import { useStoredData } from "./useStoredData";

// Category breakdown, cash flow, loan/gambling exposure, recurring expenses
// and unusual transactions — all read from what a sync already stored. Every
// label here is an inference for a human to weigh, never a verdict.

function CategoryBar({ rows, total }: { rows: SpendingAnalysisData["categoryBreakdown"]; total: number }) {
  if (!total) return null;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex h-3 overflow-hidden rounded-full bg-surface">
        {rows.map((r) => (
          <div key={r.category} style={{ width: `${(r.totalKobo / total) * 100}%`, background: CATEGORY_COLOR[r.category] }} title={`${r.label}: ${formatNaira(r.totalKobo)}`} />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-text-medium">
        {rows.map((r) => (
          <span key={r.category} className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full" style={{ background: CATEGORY_COLOR[r.category] }} />
            {r.label} <span className="tabular-nums text-text-muted">{formatNaira(r.totalKobo)}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

/** Two bars per month — in vs out — on one scale. */
function CashFlowChart({ months }: { months: SpendingAnalysisData["cashFlow"] }) {
  const max = Math.max(...months.flatMap((m) => [m.creditsKobo, m.debitsKobo]), 1);
  return (
    <div className="flex h-32 items-end gap-2">
      {months.map((m) => (
        <div key={m.month} className="flex flex-1 flex-col items-center gap-1">
          <div className="flex h-24 w-full items-end gap-0.5">
            <div className="flex-1 rounded-t-sm bg-primary transition-all" style={{ height: `${(m.creditsKobo / max) * 100}%` }} title={`In: ${formatNaira(m.creditsKobo)}`} />
            <div className="flex-1 rounded-t-sm bg-gold transition-all" style={{ height: `${(m.debitsKobo / max) * 100}%` }} title={`Out: ${formatNaira(m.debitsKobo)}`} />
          </div>
          <span className="text-[10px] font-medium text-text-muted">{m.month.slice(5)}</span>
        </div>
      ))}
    </div>
  );
}

function SignalCard({ title, signal, tone }: { title: string; signal: CategorySignal; tone: "warning" | "error" }) {
  return (
    <div className="rounded-[var(--radius-lg)] border border-dark-border/60 p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold text-text-dark">{title}</p>
        {signal.present ? <Badge tone={tone}>Present</Badge> : <Badge tone="neutral">None seen</Badge>}
      </div>
      {signal.present ? (
        <>
          <p className="mt-2 text-xl font-bold tabular-nums text-text-dark">{formatNaira(signal.totalKobo)}</p>
          <p className="mt-1 text-xs text-text-muted">
            {signal.count} transaction{signal.count === 1 ? "" : "s"} · active {signal.monthsActive} of {signal.monthsCovered} months
            {signal.lastAt && ` · last ${formatDate(signal.lastAt)}`}
          </p>
          {signal.trend && <Badge tone={TREND_TONE[signal.trend]}>{TREND_LABEL[signal.trend]}</Badge>}
          {signal.samples.length > 0 && (
            <p className="mt-2 truncate text-xs text-text-muted" title={signal.samples.join(" · ")}>
              {signal.samples.join(" · ")}
            </p>
          )}
        </>
      ) : (
        <p className="mt-2 text-xs text-text-muted">Nothing matching this in the last {signal.monthsCovered} months.</p>
      )}
    </div>
  );
}

export function SpendingAnalysis({ customerId }: { customerId: string }) {
  const { data, error } = useStoredData<SpendingAnalysisData>(`/v1/admin/customers/${customerId}/spending-analysis?months=6`);

  if (error && !data) return <p className="text-sm text-error">{error}</p>;
  if (!data) return <p className="py-6 text-center text-sm text-text-muted">Analysing spending…</p>;
  if (data.transactionsAnalysed === 0) {
    return (
      <p className="py-6 text-center text-sm text-text-muted">
        No transactions stored in the last {data.months} months to analyse yet.
      </p>
    );
  }

  const recurring = data.recurringExpenses.items.filter((i) => i.recurring);
  const totalSpend = data.categoryBreakdown.reduce((s, r) => s + r.totalKobo, 0);

  return (
    <div className="flex flex-col gap-4">
      <Section title="Where the money goes" description={`Every stored transaction from the last ${data.months} months, by category.`}>
        <CategoryBar rows={data.categoryBreakdown} total={totalSpend} />
      </Section>

      <Section title="Monthly cash flow" description="Money in against money out, one bar pair per month.">
        <CashFlowChart months={data.cashFlow} />
        <div className="mt-3 flex items-center gap-4 text-xs text-text-muted">
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-primary" /> Money in
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-gold" /> Money out
          </span>
        </div>
      </Section>

      <Section title="Loan and gambling exposure" description="Whether loan apps or betting show up in the account, and whether it's growing.">
        <div className="grid gap-3 sm:grid-cols-3">
          <SignalCard title="Loan repayments" signal={data.loanRepayment} tone="warning" />
          <SignalCard title="Loans received" signal={data.loanReceived} tone="warning" />
          <SignalCard title="Gambling" signal={data.gambling} tone="error" />
        </div>
      </Section>

      <Section title="Recurring expenses" description="Payees the customer keeps paying, grouped the same way as income sources.">
        {recurring.length === 0 ? (
          <p className="text-sm text-text-muted">No recurring payees stood out in this window.</p>
        ) : (
          <DataTable head={["Payee", "Category", "Total", "Months", "Share", "Last paid"]}>
            {recurring.map((r) => (
              <tr key={r.key}>
                <Td className="max-w-[260px] truncate font-medium text-text-dark" >
                  <span title={r.label}>{r.label}</span>
                </Td>
                <Td>
                  <Badge tone="neutral">{CATEGORY_LABEL[r.category]}</Badge>
                </Td>
                <Td className="whitespace-nowrap tabular-nums text-text-dark">{formatNaira(r.totalKobo)}</Td>
                <Td className="tabular-nums text-text-muted">{r.months}</Td>
                <Td className="tabular-nums text-text-muted">{Math.round(r.shareOfDebits * 100)}%</Td>
                <Td className="whitespace-nowrap text-text-muted">{formatDate(r.lastAt)}</Td>
              </tr>
            ))}
          </DataTable>
        )}
      </Section>

      {data.unusualTransactions.length > 0 && (
        <Section title="Unusual transactions" description="Well above what's typical for this account — worth a look, not necessarily a problem.">
          <DataTable head={["Date", "Description", "Category", "Amount", "vs. typical"]}>
            {data.unusualTransactions.map((u) => (
              <tr key={u.id}>
                <Td className="whitespace-nowrap text-text-medium">{formatDate(u.occurredAt)}</Td>
                <Td className="max-w-[260px] truncate">
                  <span title={u.narration}>{u.narration}</span>
                </Td>
                <Td>
                  <Badge tone="neutral">{CATEGORY_LABEL[u.category]}</Badge>
                </Td>
                <Td className="whitespace-nowrap tabular-nums text-text-dark">
                  {u.direction === "credit" ? "+" : "−"}
                  {formatNaira(u.amountKobo)}
                </Td>
                <Td className="tabular-nums text-text-muted">{u.multiple}×</Td>
              </tr>
            ))}
          </DataTable>
        </Section>
      )}

      <p className="text-xs text-text-muted">
        Categories are Farmer Market&apos;s own inference from each transaction&apos;s description — analytical, not a
        verdict, and the original description is always kept alongside it.
      </p>
    </div>
  );
}
