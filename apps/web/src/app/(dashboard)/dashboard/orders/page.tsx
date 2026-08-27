"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, getToken } from "../../../../lib/auth";
import { formatDateTime } from "../../../../lib/format";
import { PageHeader, Card, EmptyState } from "../../../../components/ui/Card";
import { Badge } from "../../../../components/ui/Badge";

interface OrderItem {
  name: string;
  imageUrl: string;
  quantity: number;
  unitPrice: number;
}
interface Order {
  id: string;
  status: string;
  items: OrderItem[];
  subtotal: number;
  deliveryFee: number;
  serviceFee: number;
  total: number;
  deliveryAddress: string;
  placedAt: string;
  estimatedDelivery: string | null;
  deliveredAt: string | null;
  buyerName: string | null;
  buyerPhone: string | null;
  bnplPlanName: string | null;
}

const NGN = new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN" });
const STATUSES = ["placed", "confirmed", "preparing", "on_the_way", "delivered", "cancelled"] as const;
const STATUS_TONE: Record<string, "neutral" | "info" | "success" | "error"> = {
  placed: "neutral",
  confirmed: "info",
  preparing: "info",
  on_the_way: "info",
  delivered: "success",
  cancelled: "error",
};

export default function OrdersPage() {
  const router = useRouter();
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [busyId, setBusyId] = useState<string | null>(null);

  function load() {
    apiFetch("/v1/admin/orders")
      .then(async (res) => {
        if (res.status === 401) {
          router.push("/login");
          return;
        }
        const body = await res.json();
        if (!res.ok) throw new Error(body.message ?? `Failed to load orders (${res.status})`);
        setOrders(body);
        setError(null);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load orders"));
  }

  useEffect(() => {
    if (!getToken()) {
      router.push("/login");
      return;
    }
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function setStatus(id: string, status: string) {
    setBusyId(id);
    try {
      const res = await apiFetch(`/v1/admin/orders/${id}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.message ?? "Failed to update status");
      }
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update status");
    } finally {
      setBusyId(null);
    }
  }

  const visible = useMemo(
    () => (orders ?? []).filter((o) => statusFilter === "all" || o.status === statusFilter),
    [orders, statusFilter],
  );

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const o of orders ?? []) c[o.status] = (c[o.status] ?? 0) + 1;
    return c;
  }, [orders]);

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <PageHeader title="Orders" description="Every order placed against a credit limit, and where it is in the pipeline." />
      {error && <p className="text-sm text-error">{error}</p>}

      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => setStatusFilter("all")}
          className={`rounded-full px-3.5 py-1.5 text-xs font-semibold ${
            statusFilter === "all" ? "bg-primary text-white" : "border border-dark-border/60 text-text-medium hover:bg-surface"
          }`}
        >
          All ({orders?.length ?? 0})
        </button>
        {STATUSES.map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={`rounded-full px-3.5 py-1.5 text-xs font-semibold capitalize ${
              statusFilter === s ? "bg-primary text-white" : "border border-dark-border/60 text-text-medium hover:bg-surface"
            }`}
          >
            {s.replace(/_/g, " ")} ({counts[s] ?? 0})
          </button>
        ))}
      </div>

      {orders === null ? (
        <p className="text-sm text-text-medium">Loading…</p>
      ) : visible.length === 0 ? (
        <EmptyState label="No orders here yet." />
      ) : (
        <div className="flex flex-col gap-3">
          {visible.map((o) => (
            <Card key={o.id} className="p-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs text-text-muted">{o.id.slice(0, 8)}</span>
                    <Badge tone={STATUS_TONE[o.status] ?? "neutral"}>{o.status.replace(/_/g, " ")}</Badge>
                  </div>
                  <p className="mt-1 text-sm font-semibold text-text-dark">{o.buyerName ?? "—"}</p>
                  <p className="text-xs text-text-muted">{o.buyerPhone ?? ""} · {formatDateTime(o.placedAt)}</p>
                  <p className="mt-1 text-xs text-text-muted">{o.deliveryAddress}</p>
                </div>
                <div className="text-right">
                  <p className="text-lg font-bold tabular-nums text-primary">{NGN.format(o.total)}</p>
                  <p className="text-xs text-text-muted">{o.bnplPlanName ?? "—"}</p>
                </div>
              </div>

              <div className="mt-3 flex flex-wrap gap-2 border-t border-dark-border/60 pt-3">
                {o.items.map((it, i) => (
                  <span key={i} className="rounded-[var(--radius-sm)] bg-surface px-2 py-1 text-xs text-text-medium">
                    {it.quantity}× {it.name}
                  </span>
                ))}
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span className="text-xs text-text-muted">Move to:</span>
                {STATUSES.filter((s) => s !== o.status).map((s) => (
                  <button
                    key={s}
                    disabled={busyId === o.id}
                    onClick={() => setStatus(o.id, s)}
                    className="rounded-[var(--radius-sm)] border border-dark-border/60 px-2.5 py-1 text-xs font-medium capitalize text-text-medium transition-colors hover:bg-surface disabled:opacity-50"
                  >
                    {s.replace(/_/g, " ")}
                  </button>
                ))}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
