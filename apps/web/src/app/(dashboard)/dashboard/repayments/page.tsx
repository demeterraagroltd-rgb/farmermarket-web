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

interface CollectionNotice {
  scheduleId: string;
  buyerName: string | null;
  kind: "reminder_tomorrow" | "reminder_today" | "overdue";
  daysPastDue: number;
  amountDue: string;
  channels: Array<"email" | "sms">;
}
interface CollectionRun {
  dryRun: boolean;
  scannedUnpaid: number;
  remindersDue: number;
  overdueNotices: number;
  emailsSent: number;
  smsSent: number;
  notices: CollectionNotice[];
}

export default function RepaymentsPage() {
  const router = useRouter();
  const [rows, setRows] = useState<Repayment[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [bucket, setBucket] = useState<Repayment["bucket"] | "all">("all");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [collectRun, setCollectRun] = useState<CollectionRun | null>(null);
  const [collectBusy, setCollectBusy] = useState(false);

  async function runCollections(dryRun: boolean) {
    setCollectBusy(true);
    setError(null);
    try {
      const res = await apiFetch("/v1/admin/collections/run", {
        method: "POST",
        body: JSON.stringify({ dryRun }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.message ?? "Collections run failed");
      setCollectRun(body);
      if (!dryRun) load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Collections run failed");
    } finally {
      setCollectBusy(false);
    }
  }

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
      <PageHeader
        title="Repayments"
        description="Every installment across all customers, aged by how far past due it is."
        action={
          <button
            onClick={() => runCollections(true)}
            disabled={collectBusy}
            className="rounded-[var(--radius-sm)] border border-dark-border/60 px-3 py-2 text-sm font-semibold text-text-medium transition-colors hover:bg-surface disabled:opacity-50"
          >
            {collectBusy ? "Working…" : "Run reminders"}
          </button>
        }
      />
      {error && <p className="text-sm text-error">{error}</p>}

      {collectRun && (
        <Card className="p-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-semibold text-text-dark">
                {collectRun.dryRun ? "Preview — nothing sent yet" : "Sent"}
              </p>
              <p className="mt-1 text-sm text-text-medium">
                Scanned {collectRun.scannedUnpaid} unpaid installment
                {collectRun.scannedUnpaid === 1 ? "" : "s"} · {collectRun.remindersDue} due-date reminder
                {collectRun.remindersDue === 1 ? "" : "s"} · {collectRun.overdueNotices} overdue notice
                {collectRun.overdueNotices === 1 ? "" : "s"}
                {!collectRun.dryRun &&
                  ` · ${collectRun.emailsSent} email${collectRun.emailsSent === 1 ? "" : "s"}, ${collectRun.smsSent} SMS`}
              </p>
            </div>
            <div className="flex shrink-0 gap-2">
              {collectRun.dryRun && collectRun.notices.length > 0 && (
                <button
                  onClick={() => runCollections(false)}
                  disabled={collectBusy}
                  className="rounded-[var(--radius-sm)] bg-primary px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-primary-dark disabled:opacity-50"
                >
                  Send {collectRun.notices.length} now
                </button>
              )}
              <button
                onClick={() => setCollectRun(null)}
                className="rounded-[var(--radius-sm)] border border-dark-border/60 px-3 py-1.5 text-xs font-semibold text-text-medium hover:bg-surface"
              >
                Dismiss
              </button>
            </div>
          </div>
          {collectRun.notices.length > 0 && (
            <ul className="mt-3 flex flex-col gap-1 border-t border-dark-border/40 pt-3 text-xs text-text-medium">
              {collectRun.notices.slice(0, 12).map((n) => (
                <li key={n.scheduleId} className="flex items-center justify-between gap-3">
                  <span>
                    <span className="font-medium text-text-dark">{n.buyerName ?? "—"}</span>{" "}
                    {n.kind === "overdue" ? `${n.daysPastDue}d overdue` : n.kind === "reminder_today" ? "due today" : "due tomorrow"}{" "}
                    · {n.amountDue}
                  </span>
                  <span className="tabular-nums text-text-muted">
                    {n.channels.length ? n.channels.join(" + ") : "no contact on file"}
                  </span>
                </li>
              ))}
              {collectRun.notices.length > 12 && (
                <li className="text-text-muted">+ {collectRun.notices.length - 12} more</li>
              )}
            </ul>
          )}
        </Card>
      )}

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
