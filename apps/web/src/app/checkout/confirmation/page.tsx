"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { SiteHeader } from "../../../components/site/SiteHeader";
import { Card } from "../../../components/ui/Card";
import { CheckIcon } from "../../../components/ui/icons";
import { formatDate, formatNairaAmount } from "../../../lib/format";
import { accountFetch } from "../../../lib/customer";

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
  deliveryAddress: string;
  placedAt: string;
}

// `?orderId=` needs useSearchParams, which Next's app router requires a
// Suspense boundary for even on a page that's entirely client-rendered.
export default function OrderConfirmationPage() {
  return (
    <Suspense>
      <ConfirmationContent />
    </Suspense>
  );
}

function ConfirmationContent() {
  const orderId = useSearchParams().get("orderId");
  const [order, setOrder] = useState<Order | null | undefined>(undefined);

  useEffect(() => {
    if (!orderId) {
      setOrder(null);
      return;
    }
    accountFetch(`/v1/orders/${orderId}`)
      .then((res) => (res.ok ? res.json() : null))
      .then(setOrder)
      .catch(() => setOrder(null));
  }, [orderId]);

  return (
    <>
      <SiteHeader />
      <main className="min-h-screen bg-white px-6 py-16">
        <Card className="mx-auto max-w-xl p-8 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-primary-surface text-primary">
            <CheckIcon className="h-7 w-7" />
          </div>
          <h1 className="mt-4 text-2xl font-bold text-text-dark">Order placed</h1>
          <p className="mt-2 text-text-medium">
            It&apos;s awaiting a quick approval — you&apos;ll get an email the moment it&apos;s confirmed.
          </p>

          {order === undefined ? (
            <p className="mt-6 text-sm text-text-muted">Loading order details…</p>
          ) : order ? (
            <div className="mt-6 rounded-[var(--radius-lg)] bg-surface p-4 text-left text-sm">
              <div className="flex flex-col divide-y divide-dark-border/40">
                {order.items.map((item) => (
                  <div key={item.productId} className="flex justify-between py-1.5">
                    <span className="text-text-medium">
                      {item.quantity}× {item.name}
                    </span>
                    <span className="tabular-nums text-text-dark">
                      {formatNairaAmount(item.unitPrice * item.quantity)}
                    </span>
                  </div>
                ))}
              </div>
              <div className="mt-2 flex justify-between border-t border-dark-border/40 pt-2 font-bold text-text-dark">
                <span>Total</span>
                <span className="tabular-nums text-primary">{formatNairaAmount(order.total)}</span>
              </div>
              <p className="mt-3 text-xs text-text-muted">
                Delivery to {order.deliveryAddress} · Placed {formatDate(order.placedAt)}
              </p>
            </div>
          ) : null}

          <Link
            href="/account"
            className="mt-6 inline-flex items-center justify-center rounded-[var(--radius-sm)] bg-primary px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-primary-dark"
          >
            Go to your account
          </Link>
        </Card>
      </main>
    </>
  );
}
