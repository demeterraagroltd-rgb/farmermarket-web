"use client";

import { useState } from "react";
import { Button } from "../../ui/Button";
import { Select } from "../../ui/Field";
import { formatNaira } from "../../../lib/format";
import { canSeeRawData, type StatementPeriod, type StatementView } from "../../../lib/customer360";
import { DataTable, FreshnessBadge, NotStoredYet, Section, Td, Updated, type TabProps } from "./parts";
import { downloadCsv, useStoredData } from "./useStoredData";

// A readable statement, built month by month from the transactions we hold.
// It is our reconstruction — not a bank-issued document — and says so.

const monthLabel = (m: string) =>
  new Date(`${m}-01T00:00:00Z`).toLocaleDateString("en-NG", { month: "long", year: "numeric", timeZone: "UTC" });

/** Credits and debits for a month as two bars on one scale, so busy months stand out. */
function FlowBar({ p, max }: { p: StatementPeriod; max: number }) {
  const w = (v: number) => `${v && max ? Math.max(2, (v / max) * 100) : 0}%`;
  return (
    <div className="flex min-w-[120px] flex-col gap-1" aria-hidden>
      <div className="h-1.5 rounded-full bg-surface">
        <div className="h-full rounded-full bg-primary" style={{ width: w(p.creditsKobo) }} />
      </div>
      <div className="h-1.5 rounded-full bg-surface">
        <div className="h-full rounded-full bg-gold" style={{ width: w(p.debitsKobo) }} />
      </div>
    </div>
  );
}

export function StatementsTab({ data, role }: TabProps) {
  const customerId = data.customer.id;
  const canExport = canSeeRawData(role);
  const [accountId, setAccountId] = useState("");
  const [note, setNote] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [exporting, setExporting] = useState<string | null>(null);

  const { data: st, error, loading } = useStoredData<StatementView>(
    `/v1/admin/customers/${customerId}/statement${accountId ? `?accountId=${accountId}` : ""}`,
  );

  async function exportMonth(p: StatementPeriod) {
    if (!st?.accountId) return;
    setExporting(p.month);
    setNote(null);
    // "to" is inclusive of that whole day, so the last day of the month.
    const last = new Date(Date.parse(p.to) - 86_400_000).toISOString().slice(0, 10);
    try {
      const out = await downloadCsv(
        `/v1/admin/customers/${customerId}/transactions/export.csv?accountId=${st.accountId}&from=${p.from.slice(0, 10)}&to=${last}`,
        `statement-${p.month}.csv`,
      );
      setNote({ tone: "ok", text: `${monthLabel(p.month)}: ${out.rows ?? "the"} transactions exported.` });
    } catch (e) {
      setNote({ tone: "error", text: e instanceof Error ? e.message : "Export failed" });
    } finally {
      setExporting(null);
    }
  }

  if (error && !st) return <p className="text-sm text-error">{error}</p>;
  if (!st) return <p className="py-8 text-center text-sm text-text-muted">Building the statement…</p>;

  if (!st.accountId) {
    return (
      <NotStoredYet title="No bank account linked">
        A statement is built from the customer&apos;s linked bank account. Request one from the Bank Accounts tab.
      </NotStoredYet>
    );
  }
  if (st.periods.length === 0 || !st.totals) {
    return (
      <NotStoredYet title="No transactions stored yet">
        The account is linked but no transactions have been stored, so there&apos;s nothing to build a statement from.
        Refresh from the Bank Accounts tab.
      </NotStoredYet>
    );
  }

  const max = Math.max(...st.periods.flatMap((p) => [p.creditsKobo, p.debitsKobo]));
  const anyBalance = st.periods.some((p) => p.openingKobo !== null);
  // Newest month first, like a bank's own statement list.
  const periods = [...st.periods].reverse();

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-text-medium">
          <span>
            {st.totals.count.toLocaleString()} transactions · {st.periods.length} month{st.periods.length === 1 ? "" : "s"}
          </span>
          <span className="text-text-muted">·</span>
          <Updated at={st.dataAsOf} />
          <FreshnessBadge freshness={data.financial.freshness} />
        </div>
        {st.accounts.length > 1 && (
          <div className="w-60">
            <Select label="Account" value={st.accountId} onChange={(e) => setAccountId(e.target.value)}>
              {st.accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label}
                </option>
              ))}
            </Select>
          </div>
        )}
      </div>

      <div className={`grid grid-cols-3 gap-3 ${loading ? "opacity-60" : ""}`}>
        {[
          ["Total in", st.totals.creditsKobo],
          ["Total out", st.totals.debitsKobo],
          ["Net", st.totals.netKobo],
        ].map(([label, v]) => (
          <div key={label as string} className="rounded-[var(--radius-lg)] border border-dark-border/60 px-4 py-3">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">{label}</p>
            <p className="mt-1 text-lg font-bold tabular-nums text-text-dark">
              {(v as number) < 0 ? "−" : ""}
              {formatNaira(Math.abs(v as number))}
            </p>
          </div>
        ))}
      </div>

      <Section
        title="Monthly statement"
        description={
          anyBalance ? "Opening and closing balances come from the running balance the bank reported." : "The bank didn't report running balances, so only money in and out are shown."
        }
      >
        <DataTable head={["Month", "Money in", "Money out", "Net", ...(anyBalance ? ["Opening", "Closing"] : []), "Flow", "Transactions", ...(canExport ? [""] : [])]}>
          {periods.map((p) => (
            <tr key={p.month} className={p.count === 0 ? "text-text-muted" : ""}>
              <Td className="whitespace-nowrap font-medium text-text-dark">{monthLabel(p.month)}</Td>
              <Td className="whitespace-nowrap tabular-nums text-success">{p.count ? formatNaira(p.creditsKobo) : "—"}</Td>
              <Td className="whitespace-nowrap tabular-nums">{p.count ? formatNaira(p.debitsKobo) : "—"}</Td>
              <Td className="whitespace-nowrap font-semibold tabular-nums text-text-dark">
                {p.count ? `${p.netKobo < 0 ? "−" : ""}${formatNaira(Math.abs(p.netKobo))}` : "—"}
              </Td>
              {anyBalance && (
                <>
                  <Td className="whitespace-nowrap tabular-nums">{p.openingKobo == null ? "—" : formatNaira(p.openingKobo)}</Td>
                  <Td className="whitespace-nowrap tabular-nums">{p.closingKobo == null ? "—" : formatNaira(p.closingKobo)}</Td>
                </>
              )}
              <Td>{p.count ? <FlowBar p={p} max={max} /> : null}</Td>
              <Td className="tabular-nums">{p.count || "No activity"}</Td>
              {canExport && (
                <Td>
                  {p.count > 0 && (
                    <Button variant="ghost" className="!px-2 !py-1 text-xs" onClick={() => exportMonth(p)} disabled={exporting !== null}>
                      {exporting === p.month ? "Exporting…" : "CSV"}
                    </Button>
                  )}
                </Td>
              )}
            </tr>
          ))}
        </DataTable>
        <div className="mt-3 flex items-center gap-4 text-xs text-text-muted">
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-primary" /> Money in
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-gold" /> Money out
          </span>
        </div>
        {note && <p className={`mt-2 text-xs ${note.tone === "ok" ? "text-primary" : "text-error"}`}>{note.text}</p>}
      </Section>

      <p className="text-xs text-text-muted">
        This is assembled from the transactions Mono returned and we kept (the most recent 12 months) — it is not a
        statement issued by the bank, and a month at the edge of the range may be partial.
      </p>
    </div>
  );
}
