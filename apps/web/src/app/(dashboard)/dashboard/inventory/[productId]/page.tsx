"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { apiFetch, getToken } from "../../../../../lib/auth";
import { formatDateTime, formatNairaAmount } from "../../../../../lib/format";
import {
  ADJUST_REASONS,
  MOVEMENT_LABEL,
  apiErrorMessage,
  daysUntil,
  formatDay,
  stockLabel,
  stockTone,
  type Lot,
  type Movement,
  type ProductStock,
} from "../../../../../lib/inventory";
import { Card, EmptyState } from "../../../../../components/ui/Card";
import { StatCard } from "../../../../../components/ui/StatCard";
import { Badge } from "../../../../../components/ui/Badge";
import { Button } from "../../../../../components/ui/Button";
import { Input, Select } from "../../../../../components/ui/Field";

const MOVEMENT_TONE: Record<Movement["type"], "success" | "info" | "neutral" | "warning" | "gold"> = {
  receive: "success",
  reserve: "info",
  release: "neutral",
  dispatch: "gold",
  return: "info",
  adjust: "warning",
};

const REASON_LABEL: Record<string, string> = Object.fromEntries(ADJUST_REASONS.map((r) => [r.value, r.label]));

export default function ProductStockPage() {
  const router = useRouter();
  const { productId } = useParams<{ productId: string }>();
  const [data, setData] = useState<ProductStock | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showEmptyLots, setShowEmptyLots] = useState(false);

  const [adjusting, setAdjusting] = useState<Lot | null>(null);
  const [adjust, setAdjust] = useState({ direction: "remove" as "remove" | "add", quantity: "", reason: "damage", note: "" });
  const [adjustError, setAdjustError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [threshold, setThreshold] = useState("");
  const [thresholdMsg, setThresholdMsg] = useState<string | null>(null);

  const load = useCallback(() => {
    apiFetch(`/v1/admin/inventory/products/${productId}`)
      .then(async (res) => {
        if (res.status === 401) return router.push("/login");
        const body = await res.json();
        if (!res.ok) throw new Error(body.message ?? "Failed to load this product's stock");
        setData(body);
        setThreshold(String(body.lowStockThreshold));
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load"));
  }, [productId, router]);

  useEffect(() => {
    if (!getToken()) return void router.push("/login");
    load();
  }, [load, router]);

  function startAdjust(lot: Lot) {
    setAdjusting(lot);
    setAdjust({ direction: "remove", quantity: "", reason: "damage", note: "" });
    setAdjustError(null);
  }

  async function submitAdjust(e: React.FormEvent) {
    e.preventDefault();
    if (!adjusting) return;
    setSaving(true);
    setAdjustError(null);
    try {
      const qty = Number(adjust.quantity);
      const res = await apiFetch("/v1/admin/inventory/adjust", {
        method: "POST",
        body: JSON.stringify({
          lotId: adjusting.id,
          quantityDelta: adjust.direction === "remove" ? -qty : qty,
          reason: adjust.reason,
          note: adjust.note.trim(),
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(apiErrorMessage(body) ?? "Couldn't save that adjustment");
      setAdjusting(null);
      load();
    } catch (err) {
      setAdjustError(err instanceof Error ? err.message : "Couldn't save that adjustment");
    } finally {
      setSaving(false);
    }
  }

  async function saveThreshold(e: React.FormEvent) {
    e.preventDefault();
    setThresholdMsg(null);
    const res = await apiFetch(`/v1/admin/inventory/products/${productId}/threshold`, {
      method: "PATCH",
      body: JSON.stringify({ lowStockThreshold: Number(threshold) }),
    });
    const body = await res.json();
    if (!res.ok) return setThresholdMsg(apiErrorMessage(body) ?? "Couldn't save");
    setThresholdMsg("Saved");
    load();
  }

  if (error) return <p className="text-sm text-error">{error}</p>;
  if (!data) return <p className="text-sm text-text-medium">Loading…</p>;

  const lots = data.lots.filter((l) => showEmptyLots || l.quantityRemaining > 0);
  const emptyLotCount = data.lots.length - data.lots.filter((l) => l.quantityRemaining > 0).length;
  // Oldest lot with stock left is next out of the door (FIFO).
  const nextOut = [...data.lots]
    .filter((l) => l.quantityRemaining > 0)
    .sort((a, b) => a.receivedAt.localeCompare(b.receivedAt))[0]?.id;

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <div>
        <Link href="/dashboard/inventory" className="text-xs font-semibold text-primary hover:underline">
          ← Inventory
        </Link>
        <div className="mt-2 flex items-center gap-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={data.imageUrl} alt="" className="h-14 w-14 rounded-[var(--radius-sm)] object-cover" />
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-text-dark">{data.name}</h1>
            <p className="text-sm text-text-muted">
              {data.unit}
              {data.sku ? ` · ${data.sku}` : ""} · <Badge tone={stockTone(data)}>{stockLabel(data)}</Badge>
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="On hand" value={data.onHand} />
        <StatCard label="Reserved" value={data.reserved} />
        <StatCard label="Available" value={data.available} tone={data.isLow ? "warning" : "success"} />
        <Card className="px-5 py-4">
          <form onSubmit={saveThreshold}>
            <label className="text-xs font-semibold uppercase tracking-wider text-text-muted" htmlFor="threshold">
              Low-stock alert at
            </label>
            <div className="mt-1.5 flex items-center gap-2">
              <input
                id="threshold"
                type="number"
                min={0}
                value={threshold}
                onChange={(e) => {
                  setThreshold(e.target.value);
                  setThresholdMsg(null);
                }}
                className="w-20 rounded-[var(--radius-sm)] border border-dark-border/60 px-2 py-1 text-lg font-bold tabular-nums text-text-dark"
              />
              {threshold !== String(data.lowStockThreshold) && (
                <Button type="submit" className="px-3 py-1 text-xs">
                  Save
                </Button>
              )}
              {thresholdMsg && <span className="text-xs text-text-muted">{thresholdMsg}</span>}
            </div>
          </form>
        </Card>
      </div>

      <Card className="overflow-x-auto">
        <div className="flex items-center justify-between px-5 pt-4">
          <h2 className="text-sm font-bold text-text-dark">Lots</h2>
          {emptyLotCount > 0 && (
            <button onClick={() => setShowEmptyLots((v) => !v)} className="text-xs font-semibold text-primary hover:underline">
              {showEmptyLots ? "Hide" : "Show"} {emptyLotCount} used-up lot{emptyLotCount === 1 ? "" : "s"}
            </button>
          )}
        </div>
        {lots.length === 0 ? (
          <div className="p-5">
            <EmptyState label="No stock on hand. Receive a delivery from the Inventory page." />
          </div>
        ) : (
          <table className="mt-2 w-full text-left text-sm">
            <thead>
              <tr className="border-b border-dark-border/60 text-xs font-semibold uppercase tracking-wide text-text-muted">
                <th className="px-5 py-3">Lot</th>
                <th className="px-3 py-3">Received</th>
                <th className="px-3 py-3">Expiry</th>
                <th className="px-3 py-3 text-right">Remaining</th>
                <th className="px-3 py-3 text-right">Unit cost</th>
                <th className="px-5 py-3 text-right">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {lots.map((l) => {
                const days = l.expiryDate ? daysUntil(l.expiryDate) : null;
                return (
                  <tr key={l.id} className="border-b border-dark-border/40 last:border-0">
                    <td className="px-5 py-3">
                      <span className="font-mono text-xs font-semibold text-text-dark">{l.lotCode}</span>
                      {l.id === nextOut && (
                        <span className="ml-2">
                          <Badge tone="info">Next out</Badge>
                        </span>
                      )}
                      {l.note && <p className="text-xs text-text-muted">{l.note}</p>}
                    </td>
                    <td className="px-3 py-3 text-xs text-text-medium">{formatDateTime(l.receivedAt)}</td>
                    <td className="px-3 py-3 text-xs">
                      {l.expiryDate ? (
                        <span className={days !== null && days <= 30 ? "font-semibold text-warning" : "text-text-medium"}>
                          {formatDay(l.expiryDate)}
                          {days !== null && days < 0 && <span className="block text-error">Expired</span>}
                        </span>
                      ) : (
                        <span className="text-text-muted">—</span>
                      )}
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums">
                      <span className="font-semibold text-text-dark">{l.quantityRemaining}</span>
                      <span className="text-text-muted"> / {l.quantityReceived}</span>
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums text-text-medium">
                      {l.unitCost !== null ? formatNairaAmount(l.unitCost) : "—"}
                    </td>
                    <td className="px-5 py-3 text-right">
                      <Button variant="ghost" className="px-2.5 py-1 text-xs" onClick={() => startAdjust(l)}>
                        Adjust
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}

        {adjusting && (
          <form onSubmit={submitAdjust} className="grid gap-4 border-t border-dark-border/60 bg-surface p-5 sm:grid-cols-4">
            <p className="text-sm font-semibold text-text-dark sm:col-span-4">
              Adjust lot <span className="font-mono">{adjusting.lotCode}</span> — {adjusting.quantityRemaining} left
            </p>
            <Select
              label="Change"
              value={adjust.direction}
              onChange={(e) => setAdjust((a) => ({ ...a, direction: e.target.value as "remove" | "add" }))}
            >
              <option value="remove">Remove stock</option>
              <option value="add">Add back</option>
            </Select>
            <Input
              type="number"
              label="Quantity"
              min={1}
              step={1}
              max={adjust.direction === "remove" ? adjusting.quantityRemaining : adjusting.quantityReceived - adjusting.quantityRemaining}
              value={adjust.quantity}
              onChange={(e) => setAdjust((a) => ({ ...a, quantity: e.target.value }))}
              required
            />
            <Select label="Reason" value={adjust.reason} onChange={(e) => setAdjust((a) => ({ ...a, reason: e.target.value }))}>
              {ADJUST_REASONS.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </Select>
            <Input
              label="What happened"
              placeholder="e.g. 2 bags torn in transit"
              value={adjust.note}
              onChange={(e) => setAdjust((a) => ({ ...a, note: e.target.value }))}
              required
            />
            {adjustError && <p className="whitespace-pre-line text-sm text-error sm:col-span-4">{adjustError}</p>}
            <div className="flex justify-end gap-2 sm:col-span-4">
              <Button type="button" variant="ghost" onClick={() => setAdjusting(null)}>
                Cancel
              </Button>
              <Button type="submit" variant={adjust.direction === "remove" ? "danger" : "primary"} disabled={saving}>
                {saving ? "Saving…" : adjust.direction === "remove" ? "Remove from stock" : "Add back to stock"}
              </Button>
            </div>
          </form>
        )}
      </Card>

      <Card className="overflow-x-auto">
        <h2 className="px-5 pt-4 text-sm font-bold text-text-dark">History</h2>
        {data.movements.length === 0 ? (
          <div className="p-5">
            <EmptyState label="No stock movements yet." />
          </div>
        ) : (
          <table className="mt-2 w-full text-left text-sm">
            <thead>
              <tr className="border-b border-dark-border/60 text-xs font-semibold uppercase tracking-wide text-text-muted">
                <th className="px-5 py-3">When</th>
                <th className="px-3 py-3">What</th>
                <th className="px-3 py-3 text-right">On hand</th>
                <th className="px-3 py-3 text-right">Reserved</th>
                <th className="px-3 py-3">Lot</th>
                <th className="px-5 py-3">Detail</th>
              </tr>
            </thead>
            <tbody>
              {data.movements.map((m) => (
                <tr key={m.id} className="border-b border-dark-border/40 last:border-0">
                  <td className="whitespace-nowrap px-5 py-2.5 text-xs text-text-medium">{formatDateTime(m.createdAt)}</td>
                  <td className="px-3 py-2.5">
                    <Badge tone={MOVEMENT_TONE[m.type]}>{MOVEMENT_LABEL[m.type]}</Badge>
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums">
                    <Delta n={m.onHandDelta} />
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums">
                    <Delta n={m.reservedDelta} />
                  </td>
                  <td className="px-3 py-2.5 font-mono text-xs text-text-medium">{m.lotCode ?? "—"}</td>
                  <td className="px-5 py-2.5 text-xs text-text-medium">
                    {m.reason && <span className="font-semibold">{REASON_LABEL[m.reason] ?? m.reason}: </span>}
                    {m.note}
                    {m.orderId && (
                      <>
                        {m.note ? " · " : ""}
                        order <span className="font-mono">{m.orderId.slice(0, 8)}</span>
                      </>
                    )}
                    <span className="block text-text-muted">{m.staffName ?? "System"}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}

function Delta({ n }: { n: number }) {
  if (n === 0) return <span className="text-text-muted">—</span>;
  return <span className={n > 0 ? "font-semibold text-success" : "font-semibold text-error"}>{n > 0 ? `+${n}` : n}</span>;
}
