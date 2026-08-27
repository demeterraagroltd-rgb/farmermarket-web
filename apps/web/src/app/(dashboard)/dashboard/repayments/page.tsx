"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, getToken } from "../../../../lib/auth";
import { formatDate } from "../../../../lib/format";
import { PageHeader, Card, EmptyState } from "../../../../components/ui/Card";
import { Badge } from "../../../../components/ui/Badge";

interface Repayment {
  id: string;
  orderId: string;
  buyerName: string | null;
  buyerPhone: string | null;
  amount: number;
  amountPaid: number;
  amountDue: number;
  dueDate: string;
  isPaid: boolean;
  isOverdue: boolean;
  daysPastDue: number;
  bucket: "paid" | "current" | "1-30" | "31-60" | "60+";
  installmentNumber: number;
  totalInstallments: number;
  bnplPlanName: string;
}

const NGN = new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN" });
const BUCKETS: Array<{ key: Repayment["bucket"]; label: string; tone: "success" | "neutral" | "info" | "error" }> = [
  { key: "current", label: "Current", tone: "info" },
  { key: "1-30", label: "1–30 days", tone: "neutral" },
  { key: "31-60", label: "31–60 days", tone: "error" },
  { key: "60+", label: "60+ days", tone: "error" },
  { key: "paid", label: "Paid", tone: "success" },
];

export default function RepaymentsPage() {
  const router = useRouter();
  const [rows, setRows] = useState<Repayment[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [bucket, setBucket] = useState<Repayment["bucket"] | "all">("all");
  const [busyId, setBusyId] = useState<string | null>(null);

  function load() {
    apiFetch("/v1/admin/repayments")
      .then(async (res) => {
        if (res.status === 401) {
          router.push("/login");
          return;
        }
        const body = await res.json();
        if (!res.ok) throw new Error(body.message ?? `Failed to load repayments (${res.status})`);
        setRows(body);
        setError(null);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load repayments"));
  }

  useEffect(() => {
    if (!getToken()) {
      router.push("/login");
      return;
    }
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function recordPayment(r: Repayment) {
    setBusyId(r.id);
    try {
      const res = await apiFetch(`/v1/admin/repayments/${r.id}/record`, {
        method: "POST",
        body: JSON.stringify({ amountNaira: r.amountDue }),
      });
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.message ?? "Failed to record payment");
      }
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to record payment");
    } finally {
      setBusyId(null);
    }
  }

  const totals = useMemo(() => {
    const t: Record<string, number> = {};
    for (const r of rows ?? []) t[r.bucket] = (t[r.bucket] ?? 0) + r.amountDue;
    return t;
  }, [rows]);

  const visible = useMemo(
    () => (rows ?? []).filter((r) => bucket === "all" || r.bucket === bucket),
    [rows, bucket],
  );

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <PageHeader title="Repayments" description="Every installment across all customers, aged by how far past due it is." />
      {error && <p className="text-sm text-error">{error}</p>}

      <div className="grid grid-cols-5 gap-3">
        {BUCKETS.map((b) => (
          <button
            key={b.key}
            onClick={() => setBucket(bucket === b.key ? "all" : b.key)}
            className={`rounded-[var(--radius-md)] border p-4 text-left transition-colors ${
              bucket === b.key ? "border-primary bg-primary-surface" : "border-dark-border/60 hover:bg-surface"
            }`}
          >
            <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">{b.label}</p>
            <p className="mt-1 text-sm font-bold tabular-nums text-text-dark">
              {NGN.format(totals[b.key] ?? 0)}
            </p>
          </button>
        ))}
      </div>

      {rows === null ? (
        <p className="text-sm text-text-medium">Loading…</p>
      ) : visible.length === 0 ? (
        <EmptyState label="Nothing in this bucket." />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-dark-border/60 text-left text-xs uppercase tracking-wide text-text-muted">
                <th className="py-2 pr-4">Customer</th>
                <th className="py-2 pr-4">Plan</th>
                <th className="py-2 pr-4">Installment</th>
                <th className="py-2 pr-4">Due</th>
                <th className="py-2 pr-4 text-right">Owed</th>
                <th className="py-2 pr-4">Status</th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => (
                <tr key={r.id} className="border-b border-dark-border/40">
                  <td className="py-2.5 pr-4">
                    <p className="font-medium text-text-dark">{r.buyerName ?? "—"}</p>
                    <p className="text-xs text-text-muted">{r.buyerPhone ?? ""}</p>
                  </td>
                  <td className="py-2.5 pr-4 text-text-medium">{r.bnplPlanName}</td>
                  <td className="py-2.5 pr-4 text-text-medium">
                    {r.installmentNumber}/{r.totalInstallments}
                  </td>
                  <td className="py-2.5 pr-4 text-text-medium">{formatDate(r.dueDate)}</td>
                  <td className="py-2.5 pr-4 text-right font-semibold tabular-nums text-text-dark">
                    {NGN.format(r.amountDue)}
                  </td>
                  <td className="py-2.5 pr-4">
                    {r.isPaid ? (
                      <Badge tone="success">Paid</Badge>
                    ) : r.isOverdue ? (
                      <Badge tone="error">{r.daysPastDue}d overdue</Badge>
                    ) : (
                      <Badge tone="neutral">Pending</Badge>
                    )}
                  </td>
                  <td className="py-2.5 text-right">
                    {!r.isPaid && (
                      <button
                        disabled={busyId === r.id}
                        onClick={() => recordPayment(r)}
                        className="rounded-[var(--radius-sm)] border border-dark-border/60 px-2.5 py-1 text-xs font-semibold text-text-medium transition-colors hover:bg-surface disabled:opacity-50"
                      >
                        Record payment
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
