"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { SiteHeader } from "../../../../components/site/SiteHeader";
import { Card, EmptyState } from "../../../../components/ui/Card";
import { Badge } from "../../../../components/ui/Badge";
import { formatDate, formatDateTime, formatNairaAmount } from "../../../../lib/format";
import { ORDER_STATUS_TONE, orderStatusLabel, pickupFieldLabel, pickupLabel } from "../../../../lib/orders";
import { accountFetch, getCustomerSession } from "../../../../lib/customer";

interface OrderItem {
  productId: string | null;
  bundleId?: string | null;
  components?: { productId: string; name: string; quantity: number; totalQuantity: number }[];
  name: string;
  imageUrl: string | null;
  quantity: number;
  unitPrice: number;
}

// The shape OrdersService.toResponse returns for GET /v1/orders/:id — naira,
// not kobo, so every amount goes through formatNairaAmount.
interface Order {
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
  deliverySlot: string | null;
  placedAt: string;
  approvedAt: string | null;
  estimatedDelivery: string | null;
  deliveredAt: string | null;
  rejectionReason: string | null;
}

// The page every order email links to. Kept deliberately simple: what was
// ordered, what it cost, where it is in the flow.
export default function OrderDetailPage({ params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = use(params);
  const router = useRouter();
  const [order, setOrder] = useState<Order | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!getCustomerSession()) {
      router.replace("/account/login");
      return;
    }
    accountFetch(`/v1/orders/${encodeURIComponent(orderId)}`)
      .then(async (res) => {
        if (!res.ok) {
          setOrder(null);
          setError(res.status === 404 ? "We can't find that order." : null);
          return;
        }
        setOrder(await res.json());
      })
      .catch(() => {
        setOrder(null);
        setError("Couldn't load this order.");
      });
  }, [orderId, router]);

  return (
    <>
      <SiteHeader />
      <main className="min-h-screen bg-white px-6 py-12">
        <div className="mx-auto max-w-3xl">
          <Link href="/account?tab=orders" className="text-sm font-medium text-primary hover:underline">
            &larr; All orders
          </Link>

          {order === undefined ? (
            <p className="mt-6 text-text-medium">Loading your order…</p>
          ) : order === null ? (
            <div className="mt-6">
              <EmptyState label={error ?? "We can't find that order."} />
            </div>
          ) : (
            <>
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <h1 className="text-2xl font-bold tracking-tight text-text-dark">Order</h1>
                <Badge tone={ORDER_STATUS_TONE[order.status] ?? "neutral"}>
                  {orderStatusLabel(order.status)}
                </Badge>
                <span className="font-mono text-xs text-text-muted">#{order.id.slice(0, 8)}</span>
              </div>

              {order.rejectionReason && (
                <div className="mt-4 rounded-[var(--radius-sm)] border border-error/40 bg-error/10 p-3 text-sm text-text-dark">
                  <span className="font-semibold">Why it wasn&apos;t approved:</span>{" "}
                  {order.rejectionReason}
                </div>
              )}

              <Card className="mt-6 p-5">
                <p className="text-sm font-semibold text-text-dark">Items</p>
                <div className="mt-3 flex flex-col divide-y divide-dark-border/40">
                  {order.items.map((item) => (
                    <div key={item.bundleId ?? item.productId} className="flex justify-between gap-4 py-2 text-sm">
                      <span className="text-text-medium">
                        {item.quantity}× {item.name}
                      </span>
                      <span className="tabular-nums text-text-dark">
                        {formatNairaAmount(item.unitPrice * item.quantity)}
                      </span>
                    </div>
                  ))}
                </div>

                <dl className="mt-4 flex flex-col gap-1.5 border-t border-dark-border/40 pt-3 text-sm">
                  <Row label="Subtotal" value={formatNairaAmount(order.subtotal)} />
                  <Row label="Delivery fee" value={formatNairaAmount(order.deliveryFee)} />
                  <Row label="Service fee" value={formatNairaAmount(order.serviceFee)} />
                  <div className="mt-1 flex justify-between border-t border-dark-border/40 pt-2 font-bold text-text-dark">
                    <dt>Total</dt>
                    <dd className="tabular-nums text-primary">{formatNairaAmount(order.total)}</dd>
                  </div>
                </dl>
              </Card>

              <Card className="mt-6 p-5">
                <p className="text-sm font-semibold text-text-dark">Collection</p>
                <dl className="mt-3 flex flex-col gap-2 text-sm">
                  <Row label={pickupFieldLabel(order)} value={pickupLabel(order) ?? "—"} />
                  {order.pickupDate && <Row label="Pickup date" value={formatDate(order.pickupDate)} />}
                  {order.deliverySlot && <Row label="Slot" value={order.deliverySlot} />}
                  {order.estimatedDelivery && (
                    <Row label="Expected" value={formatDate(order.estimatedDelivery)} />
                  )}
                </dl>
              </Card>

              <Card className="mt-6 p-5">
                <p className="text-sm font-semibold text-text-dark">Timeline</p>
                <dl className="mt-3 flex flex-col gap-2 text-sm">
                  <Row label="Placed" value={formatDateTime(order.placedAt)} />
                  {order.approvedAt && <Row label="Credit approved" value={formatDateTime(order.approvedAt)} />}
                  {order.deliveredAt && <Row label="Completed" value={formatDateTime(order.deliveredAt)} />}
                </dl>
              </Card>
            </>
          )}
        </div>
      </main>
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-text-muted">{label}</dt>
      <dd className="text-right text-text-dark">{value}</dd>
    </div>
  );
}
