"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { apiFetch, getToken } from "../../../../../../lib/auth";
import { formatDate, formatNaira, formatNairaAmount } from "../../../../../../lib/format";
import { pickupFieldLabel, pickupLabel } from "../../../../../../lib/orders";
import { PageHeader, Card } from "../../../../../../components/ui/Card";
import { Badge } from "../../../../../../components/ui/Badge";
import { Button } from "../../../../../../components/ui/Button";
import { Input, Textarea } from "../../../../../../components/ui/Field";
import { TONE, Field, BankAnalysisView, IdentityLookupView } from "../../../../../../components/admin/kyc-review";

type Tone = "neutral" | "info" | "success" | "error" | "gold" | "warning";

const ORDER_STATUS_TONE: Record<string, Tone> = {
  pending_approval: "gold",
  rejected: "error",
  placed: "neutral",
  confirmed: "info",
  preparing: "info",
  on_the_way: "info",
  delivered: "success",
  cancelled: "error",
};

interface OrderItem {
  bundleId?: string | null;
  components?: { productId: string; name: string; totalQuantity: number }[];
  name: string;
  imageUrl: string;
  quantity: number;
  unitPrice: number;
}
interface OrderSummary {
  id: string;
  status: string;
  items: OrderItem[];
  subtotal: number;
  deliveryFee: number;
  serviceFee: number;
  total: number;
  pickupCenterName: string | null;
  pickupCenterAddress: string | null;
  pickupDate: string | null;
  deliveryAddress: string | null;
  placedAt: string;
  approvedAt: string | null;
  deliverySlot: string | null;
  rejectionReason: string | null;
}
interface Order extends OrderSummary {
  userId: string;
  buyerName: string | null;
  buyerPhone: string | null;
  buyerEmail: string | null;
  bnplPlanName: string | null;
}
interface RepaymentRow {
  id: string;
  orderId: string;
  amount: number;
  amountPaid: number;
  amountDue: number;
  dueDate: string;
  isPaid: boolean;
  isOverdue: boolean;
  daysPastDue: number;
  bucket: "current" | "1-30" | "31-60" | "60+" | "paid";
  installmentNumber: number;
  totalInstallments: number;
  bnplPlanName: string;
}
interface CreditPosition {
  profile: {
    totalLimit: number;
    usedAmount: number;
    availableAmount: number;
    tier: string;
    score: number | null;
    isVerified: boolean;
  };
  schedules: RepaymentRow[];
  overdueCount: number;
  totalOverdue: number;
  totalOutstanding: number;
}
interface Application {
  id: string;
  reference: string;
  status: string;
  requestedLimitKobo: string | null;
  createdAt: string;
}
interface Review {
  order: Order;
  applicant: {
    profile: Record<string, unknown> & {
      fullName: string;
      verificationStatus: string;
      verificationNote: string | null;
      bvnLast4: string | null;
    bvnMashupAvailable: boolean;
      netMonthlySalaryKobo: string | null;
      requestedLimitKobo: string | null;
    };
    documents: Array<{ id: string; kind: string; status: string }>;
    events: unknown[];
  };
  creditPosition: CreditPosition;
  orderHistory: OrderSummary[];
  applications: Application[];
  repaymentPreview: Array<{ installmentNumber: number; totalInstallments: number; amount: number; dueDate: string }> | null;
  readiness: {
    kycVerified: boolean;
    identityChecked: boolean;
    bankLinked: boolean;
    hasOverdueRepayments: boolean;
    hasOtherPendingOrders: boolean;
    hasPendingApplication: boolean;
    blockers: string[];
    warnings: string[];
  };
}

const BUCKET_TONE: Record<string, Tone> = {
  paid: "success",
  current: "neutral",
  "1-30": "warning",
  "31-60": "error",
  "60+": "error",
};

function UtilizationBar({ used, limit }: { used: number; limit: number }) {
  const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  const color = pct >= 90 ? "bg-error" : pct >= 70 ? "bg-warning" : "bg-primary";
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-24 overflow-hidden rounded-full bg-surface">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="w-9 text-right text-xs tabular-nums text-text-muted">{pct}%</span>
    </div>
  );
}

function Skeleton() {
  return (
    <div className="mx-auto flex max-w-6xl animate-pulse flex-col gap-6">
      <div className="h-8 w-64 rounded bg-dark-border/30" />
      <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
        <div className="flex flex-col gap-6">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-40 rounded-[var(--radius-lg)] bg-dark-border/20" />
          ))}
        </div>
        <div className="flex flex-col gap-6">
          {[0, 1].map((i) => (
            <div key={i} className="h-52 rounded-[var(--radius-lg)] bg-dark-border/20" />
          ))}
        </div>
      </div>
    </div>
  );
}

export default function OrderReviewPage() {
  const router = useRouter();
  const { orderId } = useParams<{ orderId: string }>();
  const [data, setData] = useState<Review | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [deliverySlot, setDeliverySlot] = useState("");
  const [ack, setAck] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [rejectReason, setRejectReason] = useState("");

  const load = useCallback(() => {
    apiFetch(`/v1/admin/orders/${orderId}/review`)
      .then(async (res) => {
        if (res.status === 401) return router.push("/login");
        const body = await res.json();
        if (!res.ok) throw new Error(body.message ?? `Failed to load (${res.status})`);
        setData(body);
        setError(null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"));
  }, [orderId, router]);

  useEffect(() => {
    if (!getToken()) return void router.push("/login");
    load();
  }, [load, router]);

  async function approve() {
    setBusy(true);
    try {
      const res = await apiFetch(`/v1/admin/orders/${orderId}/approve`, {
        method: "POST",
        body: JSON.stringify(deliverySlot.trim() ? { deliverySlot: deliverySlot.trim() } : {}),
      });
      if (!res.ok) throw new Error((await res.json()).message ?? "Failed to approve");
      router.push("/dashboard/orders");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to approve");
      setBusy(false);
    }
  }

  async function confirmReject() {
    if (!rejectReason.trim()) return;
    setBusy(true);
    try {
      const res = await apiFetch(`/v1/admin/orders/${orderId}/reject`, {
        method: "POST",
        body: JSON.stringify({ reason: rejectReason.trim() }),
      });
      if (!res.ok) throw new Error((await res.json()).message ?? "Failed to reject");
      router.push("/dashboard/orders");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to reject");
      setBusy(false);
    }
  }

  if (error && !data) return <p className="text-sm text-error">{error}</p>;
  if (!data) return <Skeleton />;

  const { order, applicant, creditPosition, orderHistory, applications, repaymentPreview, readiness } = data;
  const p = applicant.profile;
  const isPending = order.status === "pending_approval";
  const canApprove = isPending && readiness.kycVerified && (readiness.warnings.length === 0 || ack);

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <div className="flex flex-wrap items-center gap-3">
        <PageHeader
          title={`Order ${order.id.slice(0, 8)}`}
          description={`${order.buyerName ?? "—"} · ${order.buyerPhone ?? ""}`}
        />
        <Badge tone={ORDER_STATUS_TONE[order.status] ?? "neutral"}>{order.status.replace(/_/g, " ")}</Badge>
        <Link href="/dashboard/orders" className="ml-auto text-xs font-semibold text-primary hover:underline">
          ← Back to orders
        </Link>
      </div>

      {error && <p className="text-sm text-error">{error}</p>}

      {!readiness.kycVerified && (
        <div className="rounded-[var(--radius-sm)] bg-error/10 px-4 py-3 text-sm font-semibold text-error">
          Verification Required — this applicant&apos;s KYC isn&apos;t verified yet. Approval is blocked until they
          are.
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
        {/* Left — applicant, verification, bank, credit history */}
        <div className="flex flex-col gap-6">
          <Card className="p-6">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-bold text-text-dark">Applicant</h3>
              <Link href={`/dashboard/kyc/${order.userId}`} className="text-xs font-semibold text-primary hover:underline">
                Full KYC record →
              </Link>
            </div>
            <Field label="Name" value={p.fullName} />
            <Field label="Phone" value={order.buyerPhone} />
            <Field label="Email" value={order.buyerEmail} />
            <Field label="Verification" value={p.verificationStatus.replace(/_/g, " ")} />
            <Field label="Net monthly salary" value={formatNaira(p.netMonthlySalaryKobo)} />
            <Field label="Requested limit" value={formatNaira(p.requestedLimitKobo)} />
            <Field label="Documents on file" value={applicant.documents.length} />
          </Card>

          <Card className="p-6">
            <h3 className="mb-2 text-sm font-bold text-text-dark">Verification — KYC / BVN</h3>
            <div className="mb-2">
              <Badge tone={TONE[p.verificationStatus] ?? "neutral"}>{p.verificationStatus.replace(/_/g, " ")}</Badge>
            </div>
            <IdentityLookupView
              userId={order.userId}
              check={p.identityLookup}
              hasNin={!!p.nin}
              bvnLast4={p.bvnLast4}
              bvnMashupAvailable={p.bvnMashupAvailable}
              checkedAt={p.identityLookupAt as string | null | undefined}
              onChecked={load}
            />
          </Card>

          <Card className="p-6">
            <h3 className="mb-2 text-sm font-bold text-text-dark">Bank &amp; Financial — Mono</h3>
            <BankAnalysisView
              userId={order.userId}
              analysis={p.bankAnalysis}
              linkedAt={p.bankLinkedAt as string | null | undefined}
              requestedAt={p.bankLinkRequestedAt as string | null | undefined}
              onRequested={load}
            />
          </Card>

          <Card className="p-6">
            <h3 className="mb-3 text-sm font-bold text-text-dark">Credit History</h3>
            <div className="mb-4 flex flex-wrap items-center gap-4 rounded-[var(--radius-sm)] border border-dark-border/60 p-3">
              <div>
                <p className="text-xs text-text-muted">Limit</p>
                <p className="text-sm font-semibold text-text-dark">{formatNairaAmount(creditPosition.profile.totalLimit)}</p>
              </div>
              <div>
                <p className="text-xs text-text-muted">Used</p>
                <UtilizationBar used={creditPosition.profile.usedAmount} limit={creditPosition.profile.totalLimit} />
              </div>
              <div>
                <p className="text-xs text-text-muted">Available</p>
                <p className="text-sm font-semibold text-text-dark">{formatNairaAmount(creditPosition.profile.availableAmount)}</p>
              </div>
              <div>
                <p className="text-xs text-text-muted">Tier</p>
                <Badge tone="gold">{creditPosition.profile.tier}</Badge>
              </div>
              {creditPosition.overdueCount > 0 && (
                <div>
                  <p className="text-xs text-text-muted">Overdue</p>
                  <p className="text-sm font-semibold text-error">
                    {creditPosition.overdueCount} · {formatNairaAmount(creditPosition.totalOverdue)}
                  </p>
                </div>
              )}
            </div>

            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-muted">Repayment schedule</h4>
            {creditPosition.schedules.length === 0 ? (
              <p className="mb-4 text-sm text-text-muted">No repayment history — no order has been approved yet.</p>
            ) : (
              <div className="mb-4 flex flex-col gap-1.5">
                {creditPosition.schedules.map((s) => (
                  <div key={s.id} className="flex items-center justify-between gap-3 rounded-[var(--radius-sm)] border border-dark-border/60 px-3 py-2 text-xs">
                    <span className="text-text-muted">
                      Order {s.orderId.slice(0, 8)} · {s.installmentNumber}/{s.totalInstallments} · due {formatDate(s.dueDate)}
                    </span>
                    <span className="flex items-center gap-2">
                      <span className="tabular-nums text-text-dark">{formatNairaAmount(s.amountDue)}</span>
                      <Badge tone={BUCKET_TONE[s.bucket] ?? "neutral"}>{s.isPaid ? "paid" : s.bucket}</Badge>
                    </span>
                  </div>
                ))}
              </div>
            )}

            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-muted">Previous orders</h4>
            {orderHistory.length === 0 ? (
              <p className="mb-4 text-sm text-text-muted">This is the customer&apos;s first order.</p>
            ) : (
              <div className="mb-4 flex flex-col gap-1.5">
                {orderHistory.map((o) => (
                  <div key={o.id} className="flex items-center justify-between gap-3 rounded-[var(--radius-sm)] border border-dark-border/60 px-3 py-2 text-xs">
                    <span className="text-text-muted">{o.id.slice(0, 8)} · {formatDate(o.placedAt)}</span>
                    <span className="flex items-center gap-2">
                      <span className="tabular-nums text-text-dark">{formatNairaAmount(o.total)}</span>
                      <Badge tone={ORDER_STATUS_TONE[o.status] ?? "neutral"}>{o.status.replace(/_/g, " ")}</Badge>
                    </span>
                  </div>
                ))}
              </div>
            )}

            {applications.length > 0 && (
              <>
                <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-muted">
                  Origination applications
                </h4>
                <div className="flex flex-col gap-1.5">
                  {applications.map((a) => (
                    <div key={a.id} className="flex items-center justify-between gap-3 rounded-[var(--radius-sm)] border border-dark-border/60 px-3 py-2 text-xs">
                      <span className="text-text-muted">{a.reference} · {formatDate(a.createdAt)}</span>
                      <span className="flex items-center gap-2">
                        <span className="tabular-nums text-text-dark">{formatNaira(a.requestedLimitKobo)}</span>
                        <Badge tone="neutral">{a.status.replace(/_/g, " ")}</Badge>
                      </span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </Card>
        </div>

        {/* Right — current order, assessment, decision */}
        <div className="flex flex-col gap-6 xl:sticky xl:top-6 xl:self-start">
          <Card className="p-6">
            <h3 className="mb-2 text-sm font-bold text-text-dark">Current Order</h3>
            <div className="mb-3 flex flex-col gap-1.5">
              {order.items.map((it, i) => (
                <div key={i} className="flex items-center justify-between text-sm">
                  <span className="text-text-medium">{it.quantity}× {it.name}</span>
                  <span className="tabular-nums text-text-dark">{formatNairaAmount(it.unitPrice * it.quantity)}</span>
                </div>
              ))}
            </div>
            <Field label="Subtotal" value={formatNairaAmount(order.subtotal)} />
            <Field label="Delivery fee" value={formatNairaAmount(order.deliveryFee)} />
            <Field label="Service fee" value={formatNairaAmount(order.serviceFee)} />
            <Field label="Total / credit amount" value={formatNairaAmount(order.total)} />
            <Field label="Plan" value={order.bnplPlanName} />
            <Field label={pickupFieldLabel(order)} value={pickupLabel(order) ?? "—"} />
            {order.pickupDate && <Field label="Pickup date" value={formatDate(order.pickupDate)} />}

            {repaymentPreview && repaymentPreview.length > 0 && (
              <>
                <h4 className="mb-1.5 mt-4 text-xs font-semibold uppercase tracking-wide text-text-muted">
                  Expected repayment on approval
                </h4>
                <div className="flex flex-col gap-1">
                  {repaymentPreview.map((i) => (
                    <div key={i.installmentNumber} className="flex items-center justify-between text-xs">
                      <span className="text-text-muted">
                        {i.installmentNumber}/{i.totalInstallments} · {formatDate(i.dueDate)}
                      </span>
                      <span className="tabular-nums text-text-dark">{formatNairaAmount(i.amount)}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </Card>

          <Card className="p-6">
            <h3 className="mb-3 text-sm font-bold text-text-dark">Assessment</h3>
            {readiness.blockers.length === 0 && readiness.warnings.length === 0 ? (
              <p className="text-sm text-success">No outstanding concerns — clear to decide.</p>
            ) : (
              <div className="flex flex-col gap-2">
                {readiness.blockers.map((b, i) => (
                  <p key={`b${i}`} className="rounded-[var(--radius-sm)] bg-error/10 px-3 py-2 text-xs text-error">
                    {b}
                  </p>
                ))}
                {readiness.warnings.map((w, i) => (
                  <p key={`w${i}`} className="rounded-[var(--radius-sm)] bg-warning/10 px-3 py-2 text-xs text-warning">
                    {w}
                  </p>
                ))}
              </div>
            )}
          </Card>

          <Card className="p-6">
            <h3 className="mb-3 text-sm font-bold text-text-dark">Decision</h3>
            {!isPending ? (
              <p className="text-sm text-text-muted">
                This order is already {order.status.replace(/_/g, " ")}
                {order.rejectionReason ? ` — ${order.rejectionReason}` : ""}.
              </p>
            ) : (
              <div className="flex flex-col gap-4">
                <div>
                  <Input
                    label="Delivery slot (optional)"
                    placeholder="e.g. Tue 3 Sep, 9am–12pm"
                    value={deliverySlot}
                    onChange={(e) => setDeliverySlot(e.target.value)}
                  />
                  {readiness.warnings.length > 0 && (
                    <label className="mt-3 flex items-start gap-2 text-xs text-text-medium">
                      <input
                        type="checkbox"
                        checked={ack}
                        onChange={(e) => setAck(e.target.checked)}
                        className="mt-0.5"
                      />
                      I&apos;ve reviewed the credit history and outstanding items above.
                    </label>
                  )}
                  <Button className="mt-3 w-full" onClick={approve} disabled={busy || !canApprove}>
                    {busy ? "Approving…" : "Approve"}
                  </Button>
                </div>

                <div className="border-t border-dark-border/60 pt-4">
                  {!rejecting ? (
                    <Button variant="danger" className="w-full" onClick={() => setRejecting(true)} disabled={busy}>
                      Reject
                    </Button>
                  ) : (
                    <div className="flex flex-col gap-2">
                      <Textarea
                        label="Why is this order not approved?"
                        rows={3}
                        value={rejectReason}
                        onChange={(e) => setRejectReason(e.target.value)}
                      />
                      <div className="flex gap-2">
                        <Button variant="danger" onClick={confirmReject} disabled={busy || !rejectReason.trim()}>
                          Confirm rejection
                        </Button>
                        <Button variant="ghost" onClick={() => setRejecting(false)} disabled={busy}>
                          Cancel
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
