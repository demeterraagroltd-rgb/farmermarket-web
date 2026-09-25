"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { apiFetch, getToken } from "../../../../../../lib/auth";
import { apiErrorMessage, formatDay, type PickList } from "../../../../../../lib/inventory";
import { Card } from "../../../../../../components/ui/Card";
import { Badge } from "../../../../../../components/ui/Badge";
import { Button } from "../../../../../../components/ui/Button";

// What the warehouse pulls for one order. Before dispatch it's the FIFO plan
// (oldest-received lot first); once the order has moved to preparing it's
// what was actually taken, lot by lot. Printable — the nav and buttons hide.
export default function PickListPage() {
  const router = useRouter();
  const { orderId } = useParams<{ orderId: string }>();
  const [data, setData] = useState<PickList | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!getToken()) return void router.push("/login");
    apiFetch(`/v1/admin/inventory/orders/${orderId}/pick-list`)
      .then(async (res) => {
        if (res.status === 401) return router.push("/login");
        const body = await res.json();
        if (!res.ok) throw new Error(apiErrorMessage(body) ?? "Failed to load the pick list");
        setData(body);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load the pick list"));
  }, [orderId, router]);

  if (error) return <p className="text-sm text-error">{error}</p>;
  if (!data) return <p className="text-sm text-text-medium">Loading…</p>;

  const short = data.lines.some((l) => l.shortBy > 0);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div className="flex items-start justify-between gap-4 print:hidden">
        <Link href="/dashboard/orders" className="text-xs font-semibold text-primary hover:underline">
          ← Orders
        </Link>
        <Button variant="ghost" onClick={() => window.print()}>
          Print
        </Button>
      </div>

      <div>
        <h1 className="text-2xl font-bold tracking-tight text-text-dark">Pick list</h1>
        <p className="mt-1 text-sm text-text-muted">
          Order <span className="font-mono">{data.orderId.slice(0, 8)}</span> · {data.status.replace(/_/g, " ")} ·{" "}
          {data.planned ? (
            <Badge tone="info">Plan — take oldest lot first</Badge>
          ) : data.stockState === "dispatched" ? (
            <Badge tone="success">Dispatched from these lots</Badge>
          ) : data.stockState === "returned" ? (
            <Badge tone="neutral">Returned to stock</Badge>
          ) : (
            <Badge tone="warning">No stock held for this order</Badge>
          )}
        </p>
      </div>

      {short && (
        <p className="rounded-[var(--radius-sm)] bg-error/10 px-4 py-3 text-sm font-semibold text-error">
          There isn&apos;t enough stock on hand to fill this order in full — see the lines marked short.
        </p>
      )}

      {data.lines.map((line) => (
        <Card key={line.productId} className="p-5">
          <div className="flex items-baseline justify-between gap-4">
            <p className="font-semibold text-text-dark">{line.name}</p>
            <p className="text-lg font-bold tabular-nums text-text-dark">× {line.quantity}</p>
          </div>
          <table className="mt-3 w-full text-left text-sm">
            <thead>
              <tr className="border-b border-dark-border/60 text-xs font-semibold uppercase tracking-wide text-text-muted">
                <th className="py-2">Lot</th>
                <th className="py-2">Expiry</th>
                <th className="py-2 text-right">Take</th>
                <th className="w-10 py-2 print:table-cell">
                  <span className="sr-only">Picked</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {line.lots.map((lot) => (
                <tr key={lot.lotId} className="border-b border-dark-border/40 last:border-0">
                  <td className="py-2 font-mono text-xs font-semibold text-text-dark">{lot.lotCode}</td>
                  <td className="py-2 text-xs text-text-medium">{lot.expiryDate ? formatDay(lot.expiryDate) : "—"}</td>
                  <td className="py-2 text-right font-semibold tabular-nums">{lot.quantity}</td>
                  <td className="py-2 text-right">
                    <span aria-hidden className="inline-block h-4 w-4 rounded-sm border border-dark-border" />
                  </td>
                </tr>
              ))}
              {line.shortBy > 0 && (
                <tr>
                  <td colSpan={4} className="py-2 text-sm font-semibold text-error">
                    Short by {line.shortBy}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </Card>
      ))}
    </div>
  );
}
