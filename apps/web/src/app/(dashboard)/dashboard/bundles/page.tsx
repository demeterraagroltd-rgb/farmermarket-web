"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { apiFetch } from "../../../../lib/auth";
import type { Bundle } from "../../../../lib/bundles";
import { formatNairaAmount } from "../../../../lib/format";
import { PageHeader, Card } from "../../../../components/ui/Card";
import { Button } from "../../../../components/ui/Button";
import { Input, Textarea, Select } from "../../../../components/ui/Field";
import { CatalogImageInput } from "../../../../components/admin/CatalogImageInput";

interface CatalogProduct { id: string; name: string; stockQuantity: number; status: string }
const empty = { name: "", slug: "", description: "", imageUrl: "", category: "Bundles", bundlePrice: "", featured: false,
  active: false, missingProducts: "", pricingNote: "", items: [] as { productId: string; quantity: number }[] };

export default function AdminBundlesPage() {
  const [bundles, setBundles] = useState<Bundle[]>([]);
  const [products, setProducts] = useState<CatalogProduct[]>([]);
  const [form, setForm] = useState(empty);
  const [editing, setEditing] = useState<string | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  async function load() {
    const [bundleRes, productRes] = await Promise.all([apiFetch("/v1/admin/catalog/bundles"), apiFetch("/v1/admin/catalog/products")]);
    if (!bundleRes.ok || !productRes.ok) {
      const failed = !bundleRes.ok ? bundleRes : productRes;
      throw new Error(`Unable to load ${!bundleRes.ok ? "bundles" : "products"} (${failed.status}). Sign in with an admin account and try again.`);
    }
    setBundles(await bundleRes.json()); setProducts(await productRes.json());
  }
  useEffect(() => { load().catch((e) => setError(e.message)).finally(() => setLoading(false)); }, []);
  function edit(bundle?: Bundle) {
    setError(""); setNotice(""); setEditing(bundle?.id ?? null);
    setForm(bundle ? { name: bundle.name, slug: bundle.slug, description: bundle.description, imageUrl: bundle.imageUrl ?? "", category: bundle.category,
      bundlePrice: bundle.bundlePrice?.toString() ?? "", featured: bundle.featured, active: bundle.active,
      missingProducts: bundle.missingProducts.join(", "), pricingNote: bundle.pricingNote, items: bundle.items.map(({ productId, quantity }) => ({ productId, quantity })) } : { ...empty, items: [] });
  }
  async function save(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError(""); setNotice("");
    try {
      const response = await apiFetch(`/v1/admin/catalog/bundles${editing ? `/${editing}` : ""}`, { method: editing ? "PATCH" : "POST", body: JSON.stringify({ ...form,
        bundlePrice: form.bundlePrice ? Number(form.bundlePrice) : null, imageUrl: form.imageUrl || null,
        missingProducts: form.missingProducts.split(",").map((v) => v.trim()).filter(Boolean) }) });
      if (!response.ok) { const data = await response.json(); throw new Error(Array.isArray(data.message) ? data.message.join("; ") : typeof data.message === "string" ? data.message : "Unable to save. Check the image, price and included products."); }
      await load(); setEditing(undefined); setNotice("Bundle saved.");
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to save bundle."); } finally { setBusy(false); }
  }
  return <><PageHeader title="Product Bundles" description="Group existing products into one purchase. Stock and combined value follow the included products." action={<Button onClick={() => edit()}>Create bundle</Button>} />
    {error && <div role="alert" className="mb-4 rounded-lg bg-error/10 p-3 text-sm text-error">{error} <button className="ml-2 underline" onClick={() => { setError(""); setLoading(true); load().catch((e) => setError(e.message)).finally(() => setLoading(false)); }}>Try again</button></div>}<p role="status" className="mb-4 text-sm text-primary">{notice}</p>
    {editing !== undefined && <Card className="mb-6 p-5"><form onSubmit={save} className="space-y-4"><h2 className="text-lg font-semibold">{editing ? "Edit bundle" : "New bundle"}</h2><div className="grid gap-4 sm:grid-cols-2">
      <Input label="Bundle name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
      <Input label="Slug" required pattern="[a-z0-9]+(-[a-z0-9]+)*" placeholder="family-kitchen-bundle" value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} />
      <Input label="Bundle price (₦)" type="number" min="0.01" step="0.01" value={form.bundlePrice} onChange={(e) => setForm({ ...form, bundlePrice: e.target.value })} />
      <Input label="Collection" value={form.category} required onChange={(e) => setForm({ ...form, category: e.target.value })} />
    </div><Textarea label="Description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
      <CatalogImageInput value={form.imageUrl} onChange={(imageUrl) => setForm((f) => ({ ...f, imageUrl }))} onBusyChange={setUploading} />
      <p className="text-xs text-text-muted">Upload one supplied composite image. Products inside it won&apos;t be combined automatically.</p>
      <div className="space-y-3"><h3 className="font-semibold">Included products</h3>{form.items.map((item, index) => <div key={index} className="flex flex-wrap items-end gap-3"><div className="min-w-40 flex-1"><Select label="Product" value={item.productId} required onChange={(e) => setForm({ ...form, items: form.items.map((i, n) => n === index ? { ...i, productId: e.target.value } : i) })}><option value="">Choose a product</option>{products.map((p) => <option key={p.id} value={p.id} disabled={form.items.some((i, n) => n !== index && i.productId === p.id)}>{p.name} ({p.status}, stock {p.stockQuantity})</option>)}</Select></div><div className="w-24"><Input label="Quantity" type="number" min="1" max="10000" required value={item.quantity} onChange={(e) => setForm({ ...form, items: form.items.map((i, n) => n === index ? { ...i, quantity: Number(e.target.value) } : i) })} /></div><Button type="button" variant="ghost" onClick={() => setForm({ ...form, items: form.items.filter((_, n) => n !== index) })}>Remove</Button></div>)}<Button type="button" variant="secondary" onClick={() => setForm({ ...form, items: [...form.items, { productId: "", quantity: 1 }] })}>Add product</Button></div>
      <Input label="Missing products (comma separated; prevents publishing)" value={form.missingProducts} onChange={(e) => setForm({ ...form, missingProducts: e.target.value })} />
      <Input label="Internal pricing note" value={form.pricingNote} onChange={(e) => setForm({ ...form, pricingNote: e.target.value })} />
      <div className="flex flex-wrap gap-6 text-sm"><label className="flex items-center gap-2"><input type="checkbox" checked={form.featured} onChange={(e) => setForm({ ...form, featured: e.target.checked })} />Featured on marketplace</label><label className="flex items-center gap-2"><input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} />Published</label></div><p className="text-xs text-text-muted">Publishing requires an image, resolved products and a price no higher than the current combined value. Unavailable stock automatically prevents checkout.</p>
      <div className="flex gap-3"><Button disabled={busy || uploading} type="submit">{busy ? "Saving…" : "Save bundle"}</Button><Button disabled={busy} type="button" variant="ghost" onClick={() => setEditing(undefined)}>Cancel</Button></div>
    </form></Card>}
    {loading ? <p role="status">Loading bundles…</p> : error && !bundles.length ? null : !bundles.length ? <Card className="p-8 text-center">No bundles yet. Create your first grocery bundle.</Card> : <div className="grid gap-4 lg:grid-cols-2">{bundles.map((bundle) => <Card key={bundle.id} className="p-5"><div className="flex items-start justify-between gap-3"><h2 className="text-lg font-semibold">{bundle.name}</h2><div className="flex items-center gap-2"><Link className="text-sm text-primary underline" href={`/marketplace/bundles/${bundle.slug}?preview=1`}>Preview</Link><Button variant="ghost" onClick={() => edit(bundle)}>Edit</Button></div></div><p className="text-sm text-text-muted">{bundle.active ? "Published" : "Draft"} · {bundle.featured ? "Featured · " : ""}{bundle.availableQuantity} available from shared stock</p><p className="mt-3 font-semibold text-primary">{bundle.bundlePrice === null ? "Set a selling price" : formatNairaAmount(bundle.bundlePrice)} <span className="text-xs font-normal text-text-muted">Combined value {formatNairaAmount(bundle.regularPrice)}</span></p><p className="mt-2 text-sm">{bundle.items.map((i) => `${i.quantity}× ${i.name}`).join(", ")}</p>{!bundle.imageUrl && <p className="mt-2 text-sm text-gold-dark">Composite image needed</p>}{bundle.missingProducts.length > 0 && <p className="mt-2 text-sm text-gold-dark">Missing: {bundle.missingProducts.join(", ")}</p>}{bundle.pricingNote && <p className="mt-2 text-xs text-text-muted">{bundle.pricingNote}</p>}</Card>)}</div>}
  </>;
}
