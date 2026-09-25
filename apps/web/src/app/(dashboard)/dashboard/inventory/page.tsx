"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { apiFetch, getToken } from "../../../../lib/auth";
import { apiErrorMessage, daysUntil, formatDay, stockLabel, stockTone, type StockRow } from "../../../../lib/inventory";
import { PageHeader, Card, EmptyState } from "../../../../components/ui/Card";
import { StatCard } from "../../../../components/ui/StatCard";
import { Badge } from "../../../../components/ui/Badge";
import { Button } from "../../../../components/ui/Button";
import { Input, Select } from "../../../../components/ui/Field";
import { PlusIcon } from "../../../../components/ui/icons";

type Filter = "all" | "low" | "out" | "expiring";

const EXPIRING_DAYS = 30;

const EMPTY_RECEIVE = { productId: "", quantity: "", unitCostNaira: "", expiryDate: "", receivedAt: "", note: "" };

// One central warehouse, kept by head office (same two roles as the catalog).
// Stock only ever changes through here or through orders — receiving creates
// a lot, and orders reserve at submit, then dispatch FIFO when preparing.
export default function InventoryPage() {
  const router = useRouter();
  const [rows, setRows] = useState<StockRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");

  const [receiving, setReceiving] = useState(false);
  const [form, setForm] = useState(EMPTY_RECEIVE);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);

  function load() {
    apiFetch("/v1/admin/inventory")
      .then(async (res) => {
        if (res.status === 401) return router.push("/login");
        const body = await res.json();
        if (!res.ok) throw new Error(body.message ?? "Failed to load inventory");
        setRows(body);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load inventory"));
  }

  useEffect(() => {
    if (!getToken()) return void router.push("/login");
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isExpiring = (r: StockRow) => r.nextExpiry !== null && daysUntil(r.nextExpiry) <= EXPIRING_DAYS;

  const counts = useMemo(() => {
    const all = rows ?? [];
    return {
      all: all.length,
      low: all.filter((r) => r.isLow && r.available > 0).length,
      out: all.filter((r) => r.available <= 0).length,
      expiring: all.filter(isExpiring).length,
      units: all.reduce((n, r) => n + r.available, 0),
      reserved: all.reduce((n, r) => n + r.reserved, 0),
    };
  }, [rows]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (rows ?? []).filter((r) => {
      if (filter === "low" && !(r.isLow && r.available > 0)) return false;
      if (filter === "out" && r.available > 0) return false;
      if (filter === "expiring" && !isExpiring(r)) return false;
      return !q || r.name.toLowerCase().includes(q) || (r.sku ?? "").toLowerCase().includes(q) || r.category.toLowerCase().includes(q);
    });
  }, [rows, filter, query]);

  function openReceive(productId = "") {
    setForm({ ...EMPTY_RECEIVE, productId });
    setFormError(null);
    setReceiving(true);
  }

  async function submitReceive(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setFormError(null);
    try {
      const payload: Record<string, unknown> = { productId: form.productId, quantity: Number(form.quantity) };
      if (form.unitCostNaira) payload.unitCostNaira = Number(form.unitCostNaira);
      if (form.expiryDate) payload.expiryDate = form.expiryDate;
      if (form.receivedAt) payload.receivedAt = new Date(`${form.receivedAt}T12:00:00`).toISOString();
      if (form.note.trim()) payload.note = form.note.trim();
      const res = await apiFetch("/v1/admin/inventory/receive", { method: "POST", body: JSON.stringify(payload) });
      const body = await res.json();
      if (!res.ok) throw new Error(apiErrorMessage(body) ?? "Couldn't record that delivery");
      const name = rows?.find((r) => r.productId === form.productId)?.name ?? "product";
      setFlash(`Received ${form.quantity} × ${name} as lot ${body.lotCode}.`);
      setReceiving(false);
      setForm(EMPTY_RECEIVE);
      load();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Couldn't record that delivery");
    } finally {
      setSaving(false);
    }
  }

  const FILTERS: { key: Filter; label: string; count: number }[] = [
    { key: "all", label: "All", count: counts.all },
    { key: "low", label: "Low", count: counts.low },
    { key: "out", label: "Out of stock", count: counts.out },
    { key: "expiring", label: `Expiring ≤ ${EXPIRING_DAYS}d`, count: counts.expiring },
  ];

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <PageHeader
        title="Inventory"
        description="Central warehouse stock. Orders reserve stock when submitted and take it from the oldest lot when moved to preparing."
        action={
          <Button onClick={() => openReceive()}>
            <PlusIcon className="h-4 w-4" />
            Receive stock
          </Button>
        }
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Units available" value={counts.units.toLocaleString()} />
        <StatCard label="Reserved for orders" value={counts.reserved.toLocaleString()} />
        <StatCard label="Low or out" value={counts.low + counts.out} tone={counts.low + counts.out > 0 ? "warning" : "success"} />
        <StatCard label={`Expiring ≤ ${EXPIRING_DAYS} days`} value={counts.expiring} tone={counts.expiring > 0 ? "warning" : "default"} />
      </div>

      {flash && (
        <div className="flex items-center justify-between rounded-[var(--radius-sm)] bg-success/10 px-4 py-3 text-sm font-medium text-success">
          <span>{flash}</span>
          <button onClick={() => setFlash(null)} className="text-xs font-semibold hover:underline">
            Dismiss
          </button>
        </div>
      )}

      {receiving && (
        <Card className="p-5">
          <h2 className="text-sm font-semibold text-text-dark">Receive a delivery</h2>
          <p className="mt-1 text-xs text-text-muted">
            Each delivery becomes its own lot. Orders take from the lot received first.
          </p>
          <form onSubmit={submitReceive} className="mt-4 grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Select
                label="Product"
                value={form.productId}
                onChange={(e) => setForm((f) => ({ ...f, productId: e.target.value }))}
                required
              >
                <option value="">Choose a product…</option>
                {(rows ?? []).map((r) => (
                  <option key={r.productId} value={r.productId}>
                    {r.name} ({r.unit}) — {r.onHand} on hand
                  </option>
                ))}
              </Select>
            </div>
            <Input
              type="number"
              label="Quantity received"
              min={1}
              step={1}
              value={form.quantity}
              onChange={(e) => setForm((f) => ({ ...f, quantity: e.target.value }))}
              required
            />
            <Input
              type="number"
              label="Unit cost (₦, optional)"
              min={0}
              step="0.01"
              value={form.unitCostNaira}
              onChange={(e) => setForm((f) => ({ ...f, unitCostNaira: e.target.value }))}
            />
            <Input
              type="date"
              label="Expiry date (optional)"
              value={form.expiryDate}
              onChange={(e) => setForm((f) => ({ ...f, expiryDate: e.target.value }))}
            />
            <Input
              type="date"
              label="Received on (default today)"
              max={new Date().toISOString().slice(0, 10)}
              value={form.receivedAt}
              onChange={(e) => setForm((f) => ({ ...f, receivedAt: e.target.value }))}
            />
            <div className="sm:col-span-2">
              <Input
                label="Note (optional)"
                placeholder="Supplier, waybill number…"
                value={form.note}
                onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
              />
            </div>
            {formError && <p className="whitespace-pre-line text-sm text-error sm:col-span-2">{formError}</p>}
            <div className="flex justify-end gap-2 border-t border-dark-border/60 pt-4 sm:col-span-2">
              <Button type="button" variant="ghost" onClick={() => setReceiving(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? "Saving…" : "Record delivery"}
              </Button>
            </div>
          </form>
        </Card>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
              filter === f.key ? "bg-primary text-white" : "border border-dark-border/60 text-text-medium hover:bg-surface"
            }`}
          >
            {f.label} <span className="tabular-nums opacity-75">{f.count}</span>
          </button>
        ))}
        <div className="ml-auto w-full sm:w-64">
          <Input placeholder="Search name, SKU, category" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search inventory" />
        </div>
      </div>

      {error && <p className="whitespace-pre-line text-sm text-error">{error}</p>}

      {rows === null && !error ? (
        <p className="text-sm text-text-medium">Loading…</p>
      ) : visible.length === 0 ? (
        <EmptyState label={rows?.length ? "Nothing matches this filter." : "No products yet — add them in the Catalog first."} />
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-dark-border/60 text-xs font-semibold uppercase tracking-wide text-text-muted">
                <th className="px-5 py-3">Product</th>
                <th className="px-3 py-3 text-right">On hand</th>
                <th className="px-3 py-3 text-right">Reserved</th>
                <th className="px-3 py-3 text-right">Available</th>
                <th className="px-3 py-3">Next expiry</th>
                <th className="px-3 py-3">Status</th>
                <th className="px-5 py-3 text-right">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => {
                const days = r.nextExpiry ? daysUntil(r.nextExpiry) : null;
                return (
                  <tr key={r.productId} className="border-b border-dark-border/40 last:border-0 hover:bg-surface">
                    <td className="px-5 py-3">
                      <Link href={`/dashboard/inventory/${r.productId}`} className="flex items-center gap-3">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={r.imageUrl} alt="" className="h-10 w-10 shrink-0 rounded-[var(--radius-sm)] object-cover" />
                        <span>
                          <span className="block font-medium text-text-dark hover:text-primary hover:underline">{r.name}</span>
                          <span className="block text-xs text-text-muted">
                            {r.category} · {r.unit}
                            {r.sku ? ` · ${r.sku}` : ""}
                            {r.status !== "published" ? ` · ${r.status}` : ""}
                          </span>
                        </span>
                      </Link>
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums text-text-medium">{r.onHand}</td>
                    <td className="px-3 py-3 text-right tabular-nums text-text-medium">{r.reserved || "—"}</td>
                    <td className="px-3 py-3 text-right text-base font-semibold tabular-nums text-text-dark">{r.available}</td>
                    <td className="px-3 py-3 text-xs">
                      {r.nextExpiry ? (
                        <span className={days !== null && days <= EXPIRING_DAYS ? "font-semibold text-warning" : "text-text-medium"}>
                          {formatDay(r.nextExpiry)}
                          <span className="block text-text-muted">
                            {days! < 0 ? `${-days!}d ago` : days === 0 ? "today" : `in ${days}d`}
                          </span>
                        </span>
                      ) : (
                        <span className="text-text-muted">—</span>
                      )}
                    </td>
                    <td className="px-3 py-3">
                      <Badge tone={stockTone(r)}>{stockLabel(r)}</Badge>
                    </td>
                    <td className="px-5 py-3 text-right">
                      <Button variant="ghost" onClick={() => openReceive(r.productId)} className="px-2.5 py-1 text-xs">
                        Receive
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}

