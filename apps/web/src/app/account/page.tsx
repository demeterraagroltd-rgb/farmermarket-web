"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { SiteHeader } from "../../components/site/SiteHeader";
import { Card, EmptyState } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { Badge } from "../../components/ui/Badge";
import { StatCard } from "../../components/ui/StatCard";
import { Tabs } from "../../components/ui/Tabs";
import { formatDate, formatNairaAmount } from "../../lib/format";
import {
  accountFetch,
  clearCustomerSession,
  getCustomerSession,
  patchCustomerSession,
  type CustomerSession,
  type VerificationStatus,
} from "../../lib/customer";

interface CreditProfile {
  totalLimit: number;
  usedAmount: number;
  availableAmount: number;
  tier: string;
}

interface OrderItem {
  productId: string;
  name: string;
  quantity: number;
  unitPrice: number;
}

interface Order {
  id: string;
  status: string;
  items: OrderItem[];
  total: number;
  placedAt: string;
  estimatedDelivery: string | null;
  deliverySlot: string | null;
  rejectionReason: string | null;
}

interface Repayment {
  id: string;
  orderId: string;
  amount: number;
  amountPaid: number;
  dueDate: string;
  isPaid: boolean;
  isOverdue: boolean;
  installmentNumber: number;
  totalInstallments: number;
  bnplPlanName: string;
}

const VERIFICATION_COPY: Record<
  VerificationStatus,
  { label: string; tone: "success" | "warning" | "info" | "neutral"; blurb: string }
> = {
  unverified: {
    label: "Not verified",
    tone: "neutral",
    blurb: "Finish the application to unlock a credit limit and checkout.",
  },
  submitted: {
    label: "Under review",
    tone: "info",
    blurb: "A credit officer is checking your details — usually within a working day.",
  },
  needs_more_info: {
    label: "Needs more info",
    tone: "warning",
    blurb: "A reviewer sent your application back — check your email for what to fix.",
  },
  verified: {
    label: "Verified",
    tone: "success",
    blurb: "Your account is verified. Orders you place go straight to review.",
  },
};

const ORDER_STATUS_TONE: Record<string, "success" | "warning" | "error" | "info" | "neutral"> = {
  pending_approval: "warning",
  confirmed: "info",
  preparing: "info",
  on_the_way: "info",
  delivered: "success",
  rejected: "error",
  cancelled: "neutral",
  placed: "info",
};

export default function AccountPage() {
  const router = useRouter();
  const [session, setSession] = useState<CustomerSession | null>(null);
  const [checkedSession, setCheckedSession] = useState(false);
  const [credit, setCredit] = useState<CreditProfile | null>(null);
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [repayments, setRepayments] = useState<Repayment[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const current = getCustomerSession();
    if (!current) {
      router.replace("/account/login");
      return;
    }
    setSession(current);
    setCheckedSession(true);
  }, [router]);

  useEffect(() => {
    if (!session) return;

    // Best-effort refresh of the verification status shown on this page —
    // mirrors AuthRepository.getCurrentUser()'s pattern on mobile: a stale
    // read is fine, a token that's since been revoked should sign out.
    accountFetch("/v1/auth/customer/me")
      .then(async (res) => {
        if (!res.ok) return;
        const body = await res.json();
        if (body?.verificationStatus) {
          patchCustomerSession({ verificationStatus: body.verificationStatus });
          setSession((s) => (s ? { ...s, verificationStatus: body.verificationStatus } : s));
        }
      })
      .catch(() => {});

    accountFetch("/v1/credit/profile")
      .then((res) => (res.ok ? res.json() : null))
      .then(setCredit)
      .catch(() => setCredit(null));

    accountFetch("/v1/orders")
      .then(async (res) => (res.ok ? res.json() : []))
      .then(setOrders)
      .catch(() => setError("Couldn't load your orders."));

    accountFetch("/v1/wallet/repayments")
      .then(async (res) => (res.ok ? res.json() : []))
      .then(setRepayments)
      .catch(() => {});
  }, [session]);

  function handleSignOut() {
    clearCustomerSession();
    router.push("/");
  }

  if (!checkedSession || !session) {
    return (
      <>
        <SiteHeader />
        <main className="min-h-screen bg-white px-6 py-16">
          <p className="mx-auto max-w-5xl text-text-medium">Loading your account…</p>
        </main>
      </>
    );
  }

  const verification = VERIFICATION_COPY[session.verificationStatus] ?? VERIFICATION_COPY.unverified;
  const upcoming = (repayments ?? [])
    .filter((r) => !r.isPaid)
    .sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime());

  return (
    <>
      <SiteHeader />
      <main className="min-h-screen bg-white px-6 py-12">
        <div className="mx-auto max-w-5xl">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-sm text-text-muted">Welcome back</p>
              <h1 className="mt-0.5 text-2xl font-bold tracking-tight text-text-dark">
                {session.fullName || session.phone}
              </h1>
            </div>
            <Button variant="ghost" onClick={handleSignOut}>
              Sign out
            </Button>
          </div>

          {/* Verification — the thing that gates everything else, so it leads. */}
          <Card className="mt-6 flex flex-wrap items-center justify-between gap-4 p-5">
            <div className="flex items-center gap-3">
              <Badge tone={verification.tone}>{verification.label}</Badge>
              <p className="text-sm text-text-medium">{verification.blurb}</p>
            </div>
            {session.verificationStatus !== "verified" && (
              <Button variant="secondary" onClick={() => router.push("/apply")}>
                Continue application
              </Button>
            )}
          </Card>

          {credit && (
            <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
              <StatCard label="Credit limit" value={formatNairaAmount(credit.totalLimit)} />
              <StatCard label="Available" value={formatNairaAmount(credit.availableAmount)} tone="success" />
              <StatCard label="In use" value={formatNairaAmount(credit.usedAmount)} />
              <StatCard label="Tier" value={credit.tier} />
            </div>
          )}

          {upcoming.length > 0 && (
            <Card className="mt-6 p-5">
              <p className="text-sm font-semibold text-text-dark">Next repayment due</p>
              <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="text-xl font-bold tabular-nums text-primary">
                  {formatNairaAmount(upcoming[0].amount - upcoming[0].amountPaid)}
                </span>
                <span className="text-sm text-text-muted">
                  due {formatDate(upcoming[0].dueDate)} · installment {upcoming[0].installmentNumber} of{" "}
                  {upcoming[0].totalInstallments} · {upcoming[0].bnplPlanName}
                </span>
                {upcoming[0].isOverdue && <Badge tone="error">Overdue</Badge>}
              </div>
            </Card>
          )}

          <Card className="mt-6 overflow-hidden">
            <Tabs tabs={[{ id: "orders", label: "Orders" }, { id: "repayments", label: "Repayments" }]}>
              {(active) =>
                active === "orders" ? (
                  <OrdersPanel orders={orders} error={error} />
                ) : (
                  <RepaymentsPanel repayments={repayments} />
                )
              }
            </Tabs>
          </Card>
        </div>
      </main>
    </>
  );
}

function OrdersPanel({ orders, error }: { orders: Order[] | null; error: string | null }) {
  if (error) return <p className="text-sm text-error">{error}</p>;
  if (orders === null) return <p className="text-sm text-text-muted">Loading orders…</p>;
  if (orders.length === 0) {
    return <EmptyState label="No orders yet — browse the marketplace to place your first one." />;
  }

  return (
    <div className="flex flex-col divide-y divide-dark-border/40">
      {orders.map((order) => (
        <div key={order.id} className="flex flex-wrap items-center justify-between gap-3 py-4">
          <div>
            <div className="flex items-center gap-2">
              <p className="font-semibold text-text-dark">
                {order.items.length} item{order.items.length === 1 ? "" : "s"}
              </p>
              <Badge tone={ORDER_STATUS_TONE[order.status] ?? "neutral"}>
                {order.status.replace(/_/g, " ")}
              </Badge>
            </div>
            <p className="mt-1 text-xs text-text-muted">
              {order.items.map((i) => `${i.quantity}× ${i.name}`).join(", ")}
            </p>
            <p className="mt-1 text-xs text-text-muted">
              Placed {formatDate(order.placedAt)}
              {order.deliverySlot ? ` · Delivery: ${order.deliverySlot}` : ""}
              {order.rejectionReason ? ` · ${order.rejectionReason}` : ""}
            </p>
          </div>
          <p className="font-bold tabular-nums text-primary">{formatNairaAmount(order.total)}</p>
        </div>
      ))}
    </div>
  );
}

function RepaymentsPanel({ repayments }: { repayments: Repayment[] | null }) {
  if (repayments === null) return <p className="text-sm text-text-muted">Loading repayments…</p>;
  if (repayments.length === 0) {
    return <EmptyState label="Nothing scheduled — a repayment plan appears here once an order is approved." />;
  }

  return (
    <div className="flex flex-col divide-y divide-dark-border/40">
      {repayments.map((r) => (
        <div key={r.id} className="flex flex-wrap items-center justify-between gap-3 py-4">
          <div>
            <div className="flex items-center gap-2">
              <p className="font-semibold text-text-dark">
                Installment {r.installmentNumber} of {r.totalInstallments}
              </p>
              {r.isPaid ? (
                <Badge tone="success">Paid</Badge>
              ) : r.isOverdue ? (
                <Badge tone="error">Overdue</Badge>
              ) : (
                <Badge tone="neutral">Due {formatDate(r.dueDate)}</Badge>
              )}
            </div>
            <p className="mt-1 text-xs text-text-muted">{r.bnplPlanName}</p>
          </div>
          <div className="text-right">
            <p className="font-bold tabular-nums text-text-dark">{formatNairaAmount(r.amount)}</p>
            {r.amountPaid > 0 && !r.isPaid && (
              <p className="text-xs text-text-muted">{formatNairaAmount(r.amountPaid)} paid</p>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
