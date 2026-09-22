"use client";

import Link from "next/link";
import { Badge } from "../../ui/Badge";
import { Card } from "../../ui/Card";
import { formatDate, formatDateTime, formatNaira, formatNairaAmount } from "../../../lib/format";
import { ACTION_LABEL, COLLECTION_LABEL, COLLECTION_TONE, timeAgo } from "../../../lib/customer360";
import { DataTable, Section, Td, type TabProps } from "./parts";

const ORDER_TONE: Record<string, "success" | "error" | "gold" | "info" | "neutral"> = {
  pending_approval: "gold",
  rejected: "error",
  placed: "neutral",
  confirmed: "info",
  preparing: "info",
  on_the_way: "info",
  delivered: "success",
  cancelled: "error",
};
const label = (s: string) => s.replace(/_/g, " ");

// ── Orders ────────────────────────────────────────────────────────────────

export function OrdersTab({ data }: TabProps) {
  if (data.orders.length === 0) return <p className="text-sm text-text-muted">This customer hasn&apos;t placed any orders.</p>;
  return (
    <div className="flex flex-col gap-3">
      <DataTable head={["Order", "Placed", "Items", "Food value", "Pickup", "Status", "Financing", "Repayment", ""]}>
        {data.orders.map((o) => (
          <tr key={o.id}>
            <Td className="font-mono text-xs text-text-medium">{o.id.slice(0, 8)}</Td>
            <Td className="whitespace-nowrap text-text-medium">{formatDate(o.placedAt)}</Td>
            <Td>
              <ul className="flex flex-col gap-0.5">
                {o.items.map((i, n) => (
                  <li key={n} className="text-text-dark">
                    {i.name} <span className="text-text-muted">× {i.quantity}</span>
                  </li>
                ))}
              </ul>
            </Td>
            <Td className="whitespace-nowrap tabular-nums text-text-dark">{formatNairaAmount(o.subtotal)}</Td>
            <Td>
              {o.pickupCenterName ? (
                <>
                  <p className="text-text-dark">{o.pickupCenterName}</p>
                  {o.pickupDate && <p className="text-xs text-text-muted">{formatDate(o.pickupDate)}</p>}
                </>
              ) : o.deliveryAddress ? (
                <span className="text-xs text-text-muted" title={o.deliveryAddress}>
                  Delivery (before pickup centres)
                </span>
              ) : (
                <span className="text-text-muted">—</span>
              )}
            </Td>
            <Td>
              <Badge tone={ORDER_TONE[o.status] ?? "neutral"}>{label(o.status)}</Badge>
            </Td>
            <Td className="text-text-medium">{o.planName ?? "—"}</Td>
            <Td>
              {o.repaymentStatus === "none" ? (
                <span className="text-text-muted">—</span>
              ) : (
                <Badge tone={COLLECTION_TONE[o.repaymentStatus]}>{COLLECTION_LABEL[o.repaymentStatus]}</Badge>
              )}
            </Td>
            <Td>
              <Link href={`/dashboard/orders/${o.id}/review`} className="text-sm font-semibold text-primary hover:underline">
                Review
              </Link>
            </Td>
          </tr>
        ))}
      </DataTable>
      <p className="text-xs text-text-muted">Vouchers aren&apos;t tracked on orders yet, so there&apos;s no voucher column.</p>
    </div>
  );
}

// ── Repayments ────────────────────────────────────────────────────────────

function Metric({ label: l, children, sub }: { label: string; children: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <Card className="px-4 py-3.5">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">{l}</p>
      <div className="mt-1.5 text-xl font-bold tabular-nums text-text-dark">{children}</div>
      {sub && <div className="mt-1 text-xs text-text-muted">{sub}</div>}
    </Card>
  );
}

const BUCKET_TONE: Record<string, "success" | "neutral" | "warning" | "error"> = {
  paid: "success",
  current: "neutral",
  "1-30": "warning",
  "31-60": "error",
  "60+": "error",
};

export function RepaymentsTab({ data }: TabProps) {
  const { summary, schedules, history } = data.repayments;
  if (schedules.length === 0) {
    return <p className="text-sm text-text-muted">No repayments — this customer has no financed orders yet.</p>;
  }
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Metric label="Total financed">{formatNairaAmount(summary.totalFinanced)}</Metric>
        <Metric label="Total repaid">{formatNairaAmount(summary.totalRepaid)}</Metric>
        <Metric label="Outstanding">{formatNairaAmount(summary.outstanding)}</Metric>
        <Metric
          label="Next payment"
          sub={summary.nextPayment ? `Due ${formatDate(summary.nextPayment.dueDate)}` : undefined}
        >
          {summary.nextPayment ? formatNairaAmount(summary.nextPayment.amountDue) : <span className="text-base font-medium text-text-muted">—</span>}
        </Metric>
        <Metric label="Collection status">
          <Badge tone={COLLECTION_TONE[summary.collectionStatus]}>{COLLECTION_LABEL[summary.collectionStatus]}</Badge>
        </Metric>
      </div>

      <Section title="Instalments">
        <DataTable head={["Order", "Instalment", "Plan", "Due", "Amount", "Paid", "Status"]}>
          {schedules.map((s) => (
            <tr key={s.id}>
              <Td className="font-mono text-xs text-text-medium">{s.orderId.slice(0, 8)}</Td>
              <Td className="text-text-dark">
                {s.installmentNumber} of {s.totalInstallments}
              </Td>
              <Td className="text-text-medium">{s.bnplPlanName}</Td>
              <Td className="whitespace-nowrap text-text-medium">{formatDate(s.dueDate)}</Td>
              <Td className="tabular-nums text-text-dark">{formatNairaAmount(s.amount)}</Td>
              <Td className="tabular-nums text-text-medium">{formatNairaAmount(s.amountPaid)}</Td>
              <Td>
                <Badge tone={BUCKET_TONE[s.bucket] ?? "neutral"}>
                  {s.isPaid ? "Paid" : s.isOverdue ? `${s.daysPastDue}d overdue` : "Current"}
                </Badge>
              </Td>
            </tr>
          ))}
        </DataTable>
      </Section>

      <Section title="Payment history" description="Every payment recorded against this customer's instalments.">
        {history.length === 0 ? (
          <p className="text-sm text-text-muted">No payments recorded yet.</p>
        ) : (
          <DataTable head={["Paid", "Amount", "Order", "Instalment"]}>
            {history.map((h) => (
              <tr key={h.id}>
                <Td className="whitespace-nowrap text-text-medium">{formatDateTime(h.paidAt)}</Td>
                <Td className="tabular-nums text-text-dark">{formatNairaAmount(h.amount)}</Td>
                <Td className="font-mono text-xs text-text-medium">{h.orderId.slice(0, 8)}</Td>
                <Td className="text-text-medium">
                  {h.installmentNumber} of {h.totalInstallments}
                </Td>
              </tr>
            ))}
          </DataTable>
        )}
        <p className="mt-3 text-xs text-text-muted">
          Payment method and failed payment attempts aren&apos;t recorded yet — only successful payments are stored.
        </p>
      </Section>
    </div>
  );
}

// ── Credit applications ───────────────────────────────────────────────────

const APP_TONE: Record<string, "success" | "error" | "gold" | "info" | "neutral"> = {
  approved: "success",
  offer_issued: "success",
  offer_accepted: "success",
  limit_active: "success",
  declined: "error",
  auto_declined: "error",
  withdrawn: "neutral",
  offer_expired: "neutral",
  info_required: "gold",
  escalated: "gold",
};

export function ApplicationsTab({ data }: TabProps) {
  if (data.applications.length === 0) {
    return <p className="text-sm text-text-muted">This customer has no credit applications.</p>;
  }
  return (
    <div className="flex flex-col gap-3">
      <DataTable head={["Reference", "Date", "Requested", "Status", "Decision", "Approved", "Tier", "Reasons / notes"]}>
        {data.applications.map((a) => (
          <tr key={a.id}>
            <Td className="font-mono text-xs text-text-dark">{a.reference}</Td>
            <Td className="whitespace-nowrap text-text-medium">{formatDate(a.submittedAt ?? a.createdAt)}</Td>
            <Td className="tabular-nums text-text-dark">{a.requestedLimitKobo == null ? "—" : formatNaira(a.requestedLimitKobo)}</Td>
            <Td>
              <Badge tone={APP_TONE[a.status] ?? "info"}>{label(a.status)}</Badge>
            </Td>
            <Td>
              {a.decision ? (
                <div>
                  <Badge tone={a.decision.outcome === "approved" ? "success" : a.decision.outcome === "declined" ? "error" : "gold"}>
                    {a.decision.outcome}
                  </Badge>
                  <p className="mt-1 text-xs text-text-muted">
                    {a.decision.decidedBy ?? "—"} · {formatDate(a.decision.decidedAt)}
                  </p>
                </div>
              ) : (
                <span className="text-text-muted">Undecided</span>
              )}
            </Td>
            <Td className="tabular-nums text-text-dark">
              {a.decision?.approvedLimitKobo == null ? "—" : formatNaira(a.decision.approvedLimitKobo)}
            </Td>
            <Td>{a.decision?.tier ? <Badge tone="gold">{a.decision.tier}</Badge> : <span className="text-text-muted">—</span>}</Td>
            <Td className="max-w-[260px] text-xs text-text-medium">
              {a.decision?.reasonCodes?.length ? <p>{a.decision.reasonCodes.join(", ")}</p> : null}
              {a.decision?.notes ? <p className="mt-0.5 text-text-muted">{a.decision.notes}</p> : null}
              {!a.decision?.reasonCodes?.length && !a.decision?.notes && <span className="text-text-muted">—</span>}
            </Td>
          </tr>
        ))}
      </DataTable>
      <p className="text-xs text-text-muted">
        Which financial data an application was decided on isn&apos;t recorded yet. A snapshot of it, taken at
        decision time, is added in a later phase so past decisions stay traceable.
      </p>
    </div>
  );
}

// ── Activity / audit log ──────────────────────────────────────────────────

export function ActivityTab({ data }: TabProps) {
  const { audit } = data;
  if (audit.length === 0) return <p className="text-sm text-text-muted">No activity recorded for this customer.</p>;
  return (
    <div className="flex flex-col gap-3">
      <ol className="flex flex-col gap-4 border-l border-dark-border/60 pl-4">
        {audit.map((a) => {
          const fields = (a.metadata?.fields as string[] | undefined) ?? [];
          const reason = a.metadata?.reason as string | undefined;
          return (
            <li key={a.id} className="relative text-sm">
              <span className="absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full bg-primary" />
              <p className="font-semibold text-text-dark">{ACTION_LABEL[a.action] ?? a.action}</p>
              <p className="text-text-medium">
                {a.staff ? `${a.staff.name} (${a.staff.email})` : "System"} ·{" "}
                <span title={formatDateTime(a.at)}>{timeAgo(a.at)}</span>
              </p>
              {fields.length > 0 && <p className="text-xs text-text-muted">Changed: {fields.join(", ")}</p>}
              {reason && <p className="text-xs text-text-muted">Reason: {reason}</p>}
            </li>
          );
        })}
      </ol>
      <p className="text-xs text-text-muted">
        Shows the most recent 200 actions. IP address and device aren&apos;t captured yet.
      </p>
    </div>
  );
}
