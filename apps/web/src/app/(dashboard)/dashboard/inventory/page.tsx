"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { apiFetch } from "../../../../lib/auth";
import { PageHeader, Card } from "../../../../components/ui/Card";
import { Button } from "../../../../components/ui/Button";
import { BoxIcon, PlusIcon, DocumentIcon, BadgeCheckIcon } from "../../../../components/ui/icons";
import WarehousePanel, {type Warehouse} from './WarehousePanel';
import { Input, Select, Textarea } from "../../../../components/ui/Field";

interface StockProduct { id: string; name: string; imageUrl: string; sku: string | null; unit: string; status: string; available: number; reserved: number; onHand: number; lowStockThreshold: number; stockStatus: string }
interface StockBundle { id: string; name: string; active: boolean; availableQuantity: number; limitingProducts: string[]; missingProducts: string[] }
interface Overview { products: StockProduct[]; bundles: StockBundle[]; summary: { products: number; lowStock: number; outOfStock: number; reservedUnits: number } }
interface Movement { id: string; productId: string; productName: string; kind: string; availableDelta: number; reservedDelta: number; availableBefore: number; availableAfter: number; reason: string; reference: string | null; actorName: string | null; orderId: string | null; receiptId?: string | null; createdAt: string }
interface History { items: Movement[]; page: number; total: number; pageSize: number }
type Form = { warehouseId:string; productId: string; kind: "receive" | "adjustment"; direction: "add" | "remove"; quantity: string; reason: string; reference: string; operationId: string };

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await apiFetch(path, options);
  const body = await response.json();
  if (!response.ok) throw new Error(typeof body.message === "string" ? body.message : "Unable to complete this request. Check the fields and try again.");
  return body;
}
const signed = (n: number) => `${n > 0 ? "+" : ""}${n}`;

export default function InventoryPage() {
  const [warehouses,setWarehouses]=useState<Warehouse[]>([]);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [history, setHistory] = useState<History | null>(null);
  const [productFilter, setProductFilter] = useState("");
  const [page, setPage] = useState(1);
  const [historyError, setHistoryError] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [stockPage, setStockPage] = useState(1);
  const [pageSize, setPageSize] = useState(5);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [form, setForm] = useState<Form | null>(null);
  const [threshold, setThreshold] = useState<{ productId: string; value: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    request<Overview>("/v1/admin/inventory").then((data) => { if (active) { setOverview(data); setError(""); } }).catch((e) => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [revision]);
  useEffect(() => {
    let active = true; setHistory(null); setHistoryError("");
    request<History>(`/v1/admin/inventory/movements?page=${page}${productFilter ? `&productId=${productFilter}` : ""}`)
      .then((data) => { if (active) setHistory(data); }).catch((e) => { if (active) setHistoryError(e.message); });
    return () => { active = false; };
  }, [page, productFilter, revision]);
  function start(product: StockProduct, kind: Form["kind"]) {
    setError(""); setNotice(""); setThreshold(null);
    setForm({ warehouseId:"", productId: product.id, kind, direction: "add", quantity: "", reason: "", reference: "", operationId: crypto.randomUUID() });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  function change(update: Partial<Form>) { setForm((f) => f ? { ...f, ...update, operationId: crypto.randomUUID() } : f); }
  async function saveMovement(event: React.FormEvent) {
    event.preventDefault(); if (!form || busy) return; setBusy(true); setError("");
    try {
      const quantity = Number(form.quantity) * (form.kind === "adjustment" && form.direction === "remove" ? -1 : 1);
      await request(`/v1/admin/inventory/products/${form.productId}/movements`, { method: "POST", body: JSON.stringify({ warehouseId:form.warehouseId, kind: form.kind, quantity, reason: form.reason.trim(), reference: form.reference.trim(), operationId: form.operationId }) });
      setForm(null); setNotice("Stock movement saved. Inventory and bundle availability have been updated."); setRevision((n) => n + 1);
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to save movement"); } finally { setBusy(false); }
  }
  async function saveThreshold(event: React.FormEvent) {
    event.preventDefault(); if (!threshold || busy) return; setBusy(true); setError("");
    try {
      await request(`/v1/admin/inventory/products/${threshold.productId}/threshold`, { method: "PATCH", body: JSON.stringify({ lowStockThreshold: Number(threshold.value) }) });
      setThreshold(null); setNotice("Low-stock threshold updated."); setRevision((n) => n + 1);
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to update threshold"); } finally { setBusy(false); }
  }
  const selected = overview?.products.find((p) => p.id === (form?.productId ?? threshold?.productId));
  const filtered = overview?.products.filter((p) => `${p.name} ${p.sku ?? ""}`.toLowerCase().includes(query.toLowerCase().trim()) && (!status || p.stockStatus === status));
  const pages = Math.max(1, Math.ceil((filtered?.length ?? 0) / pageSize));
  const currentPage = Math.min(stockPage, pages);
  const visibleProducts = filtered?.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  function exportStock() {
    const cell = (value: string | number) => '"' + String(value).replace(/^[=+@-]/, "'$&").replaceAll('"', '""') + '"';
    const rows = [["Product", "SKU", "Unit", "Publication", "On hand", "Reserved", "Available", "Threshold", "Stock status"], ...(filtered ?? []).map(p => [p.name, p.sku ?? "", p.unit, p.status, p.onHand, p.reserved, p.available, p.lowStockThreshold, p.stockStatus])];
    const url = URL.createObjectURL(new Blob(["\uFEFF" + rows.map(r => r.map(cell).join(",")).join("\r\n")], {type:"text/csv;charset=utf-8"}));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = `farmer-market-inventory-${new Date().toISOString().slice(0,10)}.csv`; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <div className="space-y-5"><div className="inventory-heading flex flex-wrap items-center justify-between gap-4"><div className="flex items-center gap-4"><span className="inventory-title-icon"><BoxIcon className="h-7 w-7" /></span><PageHeader title="Inventory" description="Receive stock, record adjustments and follow every stock movement." /></div><div className="flex gap-3"><Button disabled={busy || !overview?.products.length} onClick={() => overview && start(overview.products[0], "receive")}><PlusIcon className="h-4 w-4" />Add Stock</Button><Button className="inventory-export" variant="ghost" disabled={!overview} onClick={exportStock}><DocumentIcon className="h-4 w-4" />Export</Button></div></div>
    {error && <p role="alert" className="rounded-lg bg-error/10 p-3 text-sm text-error">{error}</p>}{notice && <p role="status" className="rounded-lg bg-primary/10 p-3 text-sm text-primary">{notice}</p>}
    {!overview ? !error && <p role="status">Loading inventory…</p> : <>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">{[{label:"Products", value:overview.summary.products, tone:"mint", icon:BoxIcon, detail:"Products in your catalog"}, {label:"Low stock", value:overview.summary.lowStock, tone:"amber", icon:BadgeCheckIcon, detail:overview.summary.lowStock ? "Restocking needed" : "All good"}, {label:"Out of stock", value:overview.summary.outOfStock, tone:"blue", icon:DocumentIcon, detail:overview.summary.outOfStock ? "Stock unavailable" : "All good"}, {label:"Reserved units", value:overview.summary.reservedUnits, tone:"violet", icon:BoxIcon, detail:"Held for open orders"}].map(({label,value,tone,icon:Icon,detail}) => <div key={label} className={`inventory-stat inventory-stat-${tone}`}><span className="inventory-stat-icon"><Icon className="h-6 w-6" /></span><div><p className="text-xs font-medium">{label}</p><p className="mt-2 text-3xl font-bold text-slate-950">{value}</p><p className="mt-3 text-[11px] text-emerald-800">{detail}</p></div></div>)}</div>
      <div className="inventory-explainer flex items-center gap-4 rounded-xl p-4"><BoxIcon className="h-8 w-8 shrink-0 text-emerald-800" /><p className="text-xs leading-6 text-emerald-800">On hand = <strong>available + reserved.</strong> Reserved stock belongs to open orders. Quantities use each product&apos;s sale unit, such as a bag, bottle or carton.</p></div>
      <WarehousePanel products={overview.products} revision={revision} onChanged={() => setRevision(n=>n+1)} onLocations={setWarehouses} /><h2 className="text-xl font-semibold">Overall stock totals</h2>
      {form && <Card className="p-5"><form onSubmit={saveMovement} className="space-y-4"><h2 className="text-lg font-semibold">{form.kind === "receive" ? "Receive stock" : "Adjust stock"} — {selected?.name}</h2><Select label="Product" value={form.productId} disabled={busy} onChange={(e) => change({productId:e.target.value})}>{overview.products.map(p => <option key={p.id} value={p.id}>{p.name} · {p.unit}</option>)}</Select><Select label="Pickup warehouse" required disabled={busy} value={form.warehouseId} onChange={e=>change({warehouseId:e.target.value})}><option value="">Choose warehouse</option>{warehouses.filter(w=>form.kind!=="receive"||w.isActive).map(w=><option key={w.id} value={w.id}>{w.name}{w.isActive?"":" (inactive)"}</option>)}</Select><p className="text-sm text-text-muted">Overall available: {selected?.available} · Reserved: {selected?.reserved} · Unit: {selected?.unit}</p><div className="grid gap-4 sm:grid-cols-2">{form.kind === "adjustment" && <Select label="Adjustment" value={form.direction} onChange={(e) => change({ direction: e.target.value as Form["direction"] })}><option value="add">Add available stock</option><option value="remove">Remove available stock</option></Select>}<Input label={`Quantity (${selected?.unit ?? "units"})`} required type="number" min="1" max="1000000" step="1" value={form.quantity} onChange={(e) => change({ quantity: e.target.value })} /><Input label="Supplier / delivery / count reference (optional)" maxLength={160} value={form.reference} onChange={(e) => change({ reference: e.target.value })} /></div><Textarea label="Reason" placeholder={form.kind === "receive" ? "Delivery received from supplier…" : "Damaged goods, loss, or stock-count correction…"} required minLength={3} maxLength={500} value={form.reason} onChange={(e) => change({ reason: e.target.value })} /><p className="text-xs text-text-muted">This creates a permanent stock-history entry. Remove adjustments cannot use stock reserved for orders.</p><div className="flex gap-3"><Button type="submit" disabled={busy}>{busy ? "Saving…" : "Record movement"}</Button><Button type="button" variant="ghost" disabled={busy} onClick={() => setForm(null)}>Cancel</Button></div></form></Card>}
      {threshold && <Card className="p-5"><form onSubmit={saveThreshold} className="space-y-3"><h2 className="font-semibold">Low-stock threshold — {selected?.name}</h2><Input label="Alert when available stock is at or below" type="number" min="0" max="1000000" required value={threshold.value} onChange={(e) => setThreshold({ ...threshold, value: e.target.value })} /><div className="flex gap-3"><Button type="submit" disabled={busy}>Save threshold</Button><Button type="button" variant="ghost" disabled={busy} onClick={() => setThreshold(null)}>Cancel</Button></div></form></Card>}
      <div className="grid gap-3 sm:grid-cols-2"><Input label="Search products" type="search" placeholder="Search product name or SKU…" value={query} onChange={(e) => { setQuery(e.target.value); setStockPage(1); }} /><Select label="Stock status" value={status} onChange={(e) => { setStatus(e.target.value); setStockPage(1); }}><option value="">All products</option><option value="low_stock">Low stock</option><option value="out_of_stock">Out of stock</option><option value="in_stock">In stock</option></Select></div>
      <Card className="inventory-table overflow-x-auto"><table className="w-full min-w-[850px] text-left text-sm"><thead className="bg-surface text-text-muted"><tr>{["Product", "On hand", "Reserved", "Available", "Threshold", "Status", "Actions"].map((label) => <th key={label} className="p-3 font-semibold">{label}</th>)}</tr></thead><tbody>{visibleProducts?.map((p) => <tr key={p.id} className="border-t border-dark-border/30"><td className="p-3"><div className="flex items-center gap-4"><img src={p.imageUrl} alt="" className="inventory-product-image" /><div><p className="font-semibold">{p.name}</p><p className="mt-1 text-xs text-text-muted">{p.unit} · {p.status}{p.sku ? ` · ${p.sku}` : ""}</p></div></div></td><td className="p-3 tabular-nums">{p.onHand}</td><td className="p-3 tabular-nums">{p.reserved}</td><td className="p-3 font-semibold tabular-nums text-primary">{p.available}</td><td className="p-3 text-amber-600">{p.lowStockThreshold}</td><td className="p-3"><span className={`rounded-full px-2 py-1 text-xs ${p.stockStatus === "out_of_stock" ? "bg-error/10 text-error" : p.stockStatus === "low_stock" ? "bg-gold/10 text-gold-dark" : "bg-primary/10 text-primary"}`}>{p.stockStatus.replaceAll("_", " ")}</span></td><td className="p-3"><div className="flex flex-wrap gap-1"><Button disabled={busy} onClick={() => start(p, "receive")}><BoxIcon className="h-4 w-4" />Receive</Button><Button className="inventory-export" variant="ghost" disabled={busy} onClick={() => start(p, "adjustment")}>Adjust</Button><details className="inventory-row-menu"><summary aria-label={`More actions for ${p.name}`}>⋮</summary><div><Button variant="ghost" disabled={busy} onClick={() => { setForm(null); setThreshold({ productId: p.id, value: String(p.lowStockThreshold) }); setError(""); window.scrollTo({ top: 0, behavior: "smooth" }); }}>Threshold</Button><a href="#stock-history" className="px-2 py-2 text-primary" onClick={() => { setProductFilter(p.id); setPage(1); }}>History</a></div></details></div></td></tr>)}</tbody></table>{filtered?.length === 0 && <p className="p-8 text-center text-text-muted">No products match these filters.</p>}<div className="inventory-pagination flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-5 py-3 text-xs text-slate-500"><p>Showing {filtered?.length ? (currentPage - 1) * pageSize + 1 : 0} – {Math.min(currentPage * pageSize, filtered?.length ?? 0)} of {filtered?.length ?? 0} products</p><div className="flex items-center gap-2"><Button variant="ghost" aria-label="Previous products page" disabled={currentPage === 1} onClick={() => setStockPage(currentPage - 1)}>‹</Button>{Array.from({length:pages}, (_,i) => i + 1).filter(n => n === 1 || n === pages || Math.abs(n - currentPage) <= 1).map(n => <Button key={n} aria-current={n === currentPage ? "page" : undefined} variant={n === currentPage ? "primary" : "ghost"} onClick={() => setStockPage(n)}>{n}</Button>)}<Button variant="ghost" aria-label="Next products page" disabled={currentPage >= pages} onClick={() => setStockPage(currentPage + 1)}>›</Button><select aria-label="Products per page" value={pageSize} onChange={e => {setPageSize(Number(e.target.value));setStockPage(1);}}>{[5,10,20,50].map(n => <option key={n} value={n}>{n} per page</option>)}</select></div></div></Card>
      <section><h2 className="mb-3 text-lg font-semibold">Bundle availability</h2><div className="grid gap-3 sm:grid-cols-2">{overview.bundles.map((b) => <Card key={b.id} className="p-4"><p className="font-semibold">{b.name}</p><p className="mt-1 text-sm text-primary">{b.availableQuantity} possible from stock · {b.active ? "Published" : "Draft"}</p><p className="mt-2 text-xs text-text-muted">{b.missingProducts.length ? `Missing: ${b.missingProducts.join(", ")}` : `Limiting products: ${b.limitingProducts.join(", ") || "None"}`}</p><Link href="/dashboard/bundles" className="mt-2 inline-block text-sm text-primary underline">Manage bundle</Link></Card>)}</div></section>
    </>}
    <section id="stock-history" className="scroll-mt-6 space-y-3"><h2 className="text-lg font-semibold">Stock movement history</h2><Select label="History product" value={productFilter} onChange={(e) => { setProductFilter(e.target.value); setPage(1); }}><option value="">All products</option>{overview?.products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select>
      {historyError ? <p role="alert" className="text-sm text-error">{historyError}</p> : !history ? <p role="status">Loading movements…</p> : <><Card className="overflow-x-auto"><table className="w-full min-w-[850px] text-left text-sm"><thead className="bg-surface text-text-muted"><tr>{["Date", "Product / action", "Available change", "Reserved change", "Available balance", "Reason / reference", "Recorded by"].map((label) => <th key={label} className="p-3">{label}</th>)}</tr></thead><tbody>{history.items.map((m) => <tr key={m.id} className="border-t border-dark-border/30"><td className="p-3 text-xs">{new Date(m.createdAt).toLocaleString("en-NG")}</td><td className="p-3"><p className="font-semibold">{m.productName}</p><p className="text-xs capitalize text-text-muted">{m.kind}</p>{m.orderId && <Link href={`/dashboard/orders/${m.orderId}/review`} className="text-xs text-primary underline">View order</Link>}{m.receiptId && <Link href={`/dashboard/purchasing?receipt=${m.receiptId}`} className="text-xs text-primary underline">View goods receipt</Link>}</td><td className="p-3 tabular-nums">{signed(m.availableDelta)}</td><td className="p-3 tabular-nums">{signed(m.reservedDelta)}</td><td className="p-3 tabular-nums">{m.availableBefore} → {m.availableAfter}</td><td className="max-w-64 whitespace-normal p-3"><p>{m.reason}</p><p className="text-xs text-text-muted">{m.reference}</p></td><td className="p-3">{m.actorName ?? (m.orderId ? "Customer checkout" : "Opening balance")}</td></tr>)}</tbody></table>{history.items.length === 0 && <p className="p-8 text-center text-text-muted">No stock movements recorded.</p>}</Card><div className="flex items-center justify-between gap-3 text-sm"><Button variant="ghost" disabled={page === 1} onClick={() => setPage((n) => n - 1)}>Previous</Button><p>Page {page} · {history.total} movements</p><Button variant="ghost" disabled={page * history.pageSize >= history.total} onClick={() => setPage((n) => n + 1)}>Next</Button></div></>}
    </section>
  </div>;
}
