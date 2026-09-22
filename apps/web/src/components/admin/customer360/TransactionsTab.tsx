"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { Badge } from "../../ui/Badge";
import { Button } from "../../ui/Button";
import { Input, Select } from "../../ui/Field";
import { formatDate, formatDateTime, formatNaira } from "../../../lib/format";
import { canSeeRawData, type BankTransaction, type TransactionDetail, type TransactionPage } from "../../../lib/customer360";
import { DataTable, FreshnessBadge, NotStoredYet, Row, Section, Td, Updated, type TabProps } from "./parts";
import { JsonViewer } from "./JsonViewer";
import { downloadCsv, useStoredData } from "./useStoredData";

// The customer's stored transactions, searchable and filterable. Reads only what
// a sync already saved — filtering and paging never reach Mono.

interface Filters {
  accountId: string;
  type: "" | "credit" | "debit";
  from: string;
  to: string;
  minNaira: string;
  maxNaira: string;
  channel: string;
  q: string;
  sort: "newest" | "oldest" | "largest" | "smallest";
}
const EMPTY: Filters = { accountId: "", type: "", from: "", to: "", minNaira: "", maxNaira: "", channel: "", q: "", sort: "newest" };
const PAGE_SIZE = 25;

/** Waits for typing to pause so each keystroke isn't a request. */
function useDebounced<T>(value: T, ms = 350): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

function queryOf(f: Filters, extra: Record<string, string | number> = {}): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...f, ...extra })) if (v !== "" && v !== undefined) p.set(k, String(v));
  return p.toString();
}

/** Naira inputs are free text; an unusable value must not become a request that 400s. */
const validNaira = (s: string) => s === "" || (Number.isFinite(Number(s)) && Number(s) >= 0);

function RawRecord({ customerId, txId }: { customerId: string; txId: string }) {
  const { data, error, loading } = useStoredData<TransactionDetail>(`/v1/admin/customers/${customerId}/transactions/${txId}`);
  if (loading && !data) return <p className="text-xs text-text-muted">Opening the original record…</p>;
  if (error) return <p className="text-xs text-error">{error}</p>;
  return <JsonViewer value={data?.raw ?? null} maxHeight="18rem" />;
}

function ExpandedRow({ tx, customerId, canRaw }: { tx: BankTransaction; customerId: string; canRaw: boolean }) {
  // The raw record is fetched only on an explicit click, so browsing the table
  // doesn't write an audit row per expanded line.
  const [showRaw, setShowRaw] = useState(false);
  return (
    <div className="grid gap-x-8 gap-y-1 sm:grid-cols-2">
      <div>
        <Row label="Description" value={tx.narration || null} />
        <Row label="Date & time" value={formatDateTime(tx.occurredAt)} />
        <Row label="Channel" value={tx.channel} origin="bank" />
        <Row label="Category" value={tx.category} />
      </div>
      <div>
        <Row label="Amount" value={`${tx.direction === "credit" ? "+" : "−"}${formatNaira(tx.amountKobo)}`} />
        <Row label="Balance after" value={tx.balanceAfterKobo == null ? null : formatNaira(tx.balanceAfterKobo)} origin="bank" />
        <Row label="Fetched" value={<Updated at={tx.retrievedAt} prefix="" />} />
        <Row label="Record ID" value={tx.id} mono />
      </div>
      {canRaw && (
        <div className="mt-2 sm:col-span-2">
          {showRaw ? (
            <RawRecord customerId={customerId} txId={tx.id} />
          ) : (
            <Button variant="ghost" onClick={() => setShowRaw(true)}>
              View raw Mono data
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

export function TransactionsTab({ data, role }: TabProps) {
  const customerId = data.customer.id;
  const canRaw = canSeeRawData(role);

  const [filters, setFilters] = useState<Filters>(EMPTY);
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [note, setNote] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  const set = <K extends keyof Filters>(k: K, v: Filters[K]) => {
    setFilters((f) => ({ ...f, [k]: v }));
    setPage(1);
    setOpen(null);
  };

  // Only the search box is debounced; the other controls are discrete.
  const debouncedQ = useDebounced(filters.q);
  const effective = useMemo(() => ({ ...filters, q: debouncedQ }), [filters, debouncedQ]);

  const valid = validNaira(filters.minNaira) && validNaira(filters.maxNaira) && !(filters.from && filters.to && filters.from > filters.to);
  const path = valid ? `/v1/admin/customers/${customerId}/transactions?${queryOf(effective, { page, pageSize: PAGE_SIZE })}` : null;
  const { data: result, error, loading } = useStoredData<TransactionPage>(path);

  const filtering = JSON.stringify({ ...filters, sort: "" }) !== JSON.stringify({ ...EMPTY, sort: "" });

  async function exportCsv() {
    setExporting(true);
    setNote(null);
    try {
      const out = await downloadCsv(`/v1/admin/customers/${customerId}/transactions/export.csv?${queryOf(effective)}`, "transactions.csv");
      setNote({
        tone: "ok",
        text: `${out.rows ?? "The"} transactions exported${out.truncated ? " — the file was capped at the export limit; narrow the filters for the rest" : ""}.`,
      });
    } catch (e) {
      setNote({ tone: "error", text: e instanceof Error ? e.message : "Export failed" });
    } finally {
      setExporting(false);
    }
  }

  // Nothing linked / nothing stored yet — say which, and what to do.
  if (result && result.coverage.total === 0 && !filtering) {
    return (
      <NotStoredYet title={result.accounts.length === 0 ? "No bank account linked" : "No transactions stored yet"}>
        {result.accounts.length === 0
          ? "Transactions come from the customer's linked bank account. Request one from the Bank Accounts tab."
          : "The account is linked but Mono hasn't returned any transactions yet. Refresh from the Bank Accounts tab."}
      </NotStoredYet>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {result && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-text-medium">
          <span>
            {result.coverage.total.toLocaleString()} stored
            {result.coverage.earliest && result.coverage.latest && (
              <>
                {" "}
                · {formatDate(result.coverage.earliest)} – {formatDate(result.coverage.latest)}
              </>
            )}
          </span>
          <span className="text-text-muted">·</span>
          <Updated at={result.coverage.dataAsOf} />
          <FreshnessBadge freshness={data.financial.freshness} />
        </div>
      )}

      <Section title="Filters">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Input
            label="Search description"
            placeholder="e.g. salary, POS, airtime"
            value={filters.q}
            onChange={(e) => set("q", e.target.value)}
            maxLength={120}
          />
          <Select label="Type" value={filters.type} onChange={(e) => set("type", e.target.value as Filters["type"])}>
            <option value="">Credits & debits</option>
            <option value="credit">Credits (money in)</option>
            <option value="debit">Debits (money out)</option>
          </Select>
          <Input label="From" type="date" value={filters.from} onChange={(e) => set("from", e.target.value)} />
          <Input label="To" type="date" value={filters.to} onChange={(e) => set("to", e.target.value)} />
          <Input label="Min amount (₦)" inputMode="decimal" placeholder="0" value={filters.minNaira} onChange={(e) => set("minNaira", e.target.value)} />
          <Input label="Max amount (₦)" inputMode="decimal" placeholder="No limit" value={filters.maxNaira} onChange={(e) => set("maxNaira", e.target.value)} />
          <Select label="Channel" value={filters.channel} onChange={(e) => set("channel", e.target.value)}>
            <option value="">All channels</option>
            {(result?.channels ?? []).map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
          <Select label="Sort" value={filters.sort} onChange={(e) => set("sort", e.target.value as Filters["sort"])}>
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
            <option value="largest">Largest amount</option>
            <option value="smallest">Smallest amount</option>
          </Select>
          {result && result.accounts.length > 1 && (
            <Select label="Account" value={filters.accountId} onChange={(e) => set("accountId", e.target.value)}>
              <option value="">All accounts</option>
              {result.accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label}
                </option>
              ))}
            </Select>
          )}
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            {filtering && (
              <Button variant="ghost" onClick={() => { setFilters(EMPTY); setPage(1); setOpen(null); }}>
                Clear filters
              </Button>
            )}
          </div>
          {canRaw && (
            <Button variant="secondary" onClick={exportCsv} disabled={exporting || !valid}>
              {exporting ? "Exporting…" : "Export CSV"}
            </Button>
          )}
        </div>
        {!valid && <p className="mt-2 text-xs text-error">Check the filters: amounts must be numbers and the start date can&apos;t be after the end date.</p>}
        {note && <p className={`mt-2 text-xs ${note.tone === "ok" ? "text-primary" : "text-error"}`}>{note.text}</p>}
      </Section>

      {error && <p className="text-sm text-error">{error}</p>}

      <Section
        title="Transactions"
        description={
          result
            ? `${result.total.toLocaleString()} match${result.total === 1 ? "es" : ""} · in ${formatNaira(result.summary.creditsKobo)} · out ${formatNaira(result.summary.debitsKobo)} · net ${result.summary.netKobo < 0 ? "−" : ""}${formatNaira(Math.abs(result.summary.netKobo))}`
            : undefined
        }
      >
        {!result ? (
          <p className="py-8 text-center text-sm text-text-muted">Loading transactions…</p>
        ) : result.items.length === 0 ? (
          <p className="py-8 text-center text-sm text-text-muted">No transactions match these filters.</p>
        ) : (
          <div className={loading ? "opacity-60 transition-opacity" : "transition-opacity"} aria-busy={loading}>
            <DataTable head={["Date", "Description", "Channel", "Type", "Amount", "Balance"]}>
              {result.items.map((tx) => {
                const expanded = open === tx.id;
                return (
                  <Fragment key={tx.id}>
                    <tr
                      className="cursor-pointer hover:bg-surface"
                      onClick={() => setOpen(expanded ? null : tx.id)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          setOpen(expanded ? null : tx.id);
                        }
                      }}
                      tabIndex={0}
                      aria-expanded={expanded}
                    >
                      <Td className="whitespace-nowrap text-text-medium">{formatDateTime(tx.occurredAt)}</Td>
                      <Td className="max-w-[320px] truncate text-text-dark" >
                        <span title={tx.narration}>{tx.narration || <span className="text-text-muted">—</span>}</span>
                      </Td>
                      <Td className="text-text-muted">{tx.channel ?? "—"}</Td>
                      <Td>
                        <Badge tone={tx.direction === "credit" ? "success" : "neutral"}>{tx.direction === "credit" ? "Credit" : "Debit"}</Badge>
                      </Td>
                      <Td className={`whitespace-nowrap text-right font-semibold tabular-nums ${tx.direction === "credit" ? "text-success" : "text-text-dark"}`}>
                        {tx.direction === "credit" ? "+" : "−"}
                        {formatNaira(tx.amountKobo)}
                      </Td>
                      <Td className="whitespace-nowrap text-right tabular-nums text-text-muted">
                        {tx.balanceAfterKobo == null ? "—" : formatNaira(tx.balanceAfterKobo)}
                      </Td>
                    </tr>
                    {expanded && (
                      <tr>
                        <td colSpan={6} className="border-b border-dark-border/40 bg-surface/60 px-4 py-4">
                          <ExpandedRow tx={tx} customerId={customerId} canRaw={canRaw} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </DataTable>

            <div className="mt-3 flex items-center justify-between gap-3 text-sm text-text-medium">
              <span>
                Page {result.page} of {result.totalPages}
              </span>
              <div className="flex gap-2">
                <Button variant="ghost" onClick={() => { setPage((p) => p - 1); setOpen(null); }} disabled={page <= 1 || loading}>
                  Previous
                </Button>
                <Button variant="ghost" onClick={() => { setPage((p) => p + 1); setOpen(null); }} disabled={page >= result.totalPages || loading}>
                  Next
                </Button>
              </div>
            </div>
          </div>
        )}
      </Section>

      <p className="text-xs text-text-muted">
        Only the most recent 12 months are kept. Channels are Mono&apos;s own labels; descriptions are exactly as the bank
        wrote them.
      </p>
    </div>
  );
}
