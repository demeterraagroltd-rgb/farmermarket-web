"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { type Bundle, addBundleToCart } from "../../../../lib/bundles";
import { apiFetch } from "../../../../lib/auth";
import { formatNairaAmount } from "../../../../lib/format";
import { SiteHeader } from "../../../../components/site/SiteHeader";
import { Button } from "../../../../components/ui/Button";
import { BundleSavingsBadge } from "../../../../components/marketplace/BundleCard";

export default function BundleDetailPage() {
  const { slug } = useParams<{ slug: string }>();
  const [bundle, setBundle] = useState<Bundle | null>(null);
  const [error, setError] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [preview, setPreview] = useState(false);
  const [notice, setNotice] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    setBundle(null); setError(""); setQuantity(1); setNotice("");
    const draftPreview = new URLSearchParams(window.location.search).get("preview") === "1";
    setPreview(draftPreview);
    const request = draftPreview ? apiFetch("/v1/admin/catalog/bundles", { signal: controller.signal }) : fetch(`${process.env.NEXT_PUBLIC_API_URL}/v1/catalog/bundles/${encodeURIComponent(slug)}`, { signal: controller.signal, cache: "no-store" });
    request.then(async (r) => {
      if (!r.ok) throw new Error(draftPreview ? "Sign in as an administrator to preview drafts." : r.status === 404 ? "This bundle isn't available." : "Unable to load this bundle.");
      const data = await r.json();
      const result = draftPreview ? (data as Bundle[]).find((b) => b.slug === slug) : data;
      if (!result) throw new Error("Bundle not found.");
      setBundle(result);
    })
      .catch((e) => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "Unable to load bundle."); });
    return () => controller.abort();
  }, [slug]);
  return <><SiteHeader /><main className="mx-auto max-w-[1120px] px-4 py-8 sm:px-6">
    <Link href="/marketplace" className="text-sm text-primary">← Back to marketplace</Link>
    {error ? <p role="alert" className="mt-8">{error}</p> : !bundle ? <p className="mt-8" role="status">Loading bundle…</p> : <>
      {preview && <p className="mt-4 rounded-lg bg-[#fff2d4] p-3 text-sm text-[#9c5700]">Admin preview ? {bundle.active ? "Published bundle" : "Draft bundle"}{bundle.missingProducts.length > 0 ? ` ? Missing: ${bundle.missingProducts.join(", ")}` : ""}{bundle.pricingNote ? ` ? ${bundle.pricingNote}` : ""}</p>}
      <div className="mt-6 grid gap-8 md:grid-cols-2">
        <div className="flex min-h-72 items-center justify-center rounded-3xl border border-[#e7ede8] bg-[#fafaf8] p-6">
          {bundle.imageUrl ? <>{/* eslint-disable-next-line @next/next/no-img-element */}<img src={bundle.imageUrl} alt={bundle.name} className="max-h-[500px] w-full object-contain" /></> : <p>Bundle image coming soon</p>}
        </div>
        <div><span className="rounded-full bg-[#e5f3ec] px-3 py-1 text-sm text-primary">{bundle.category}</span><h1 className="mt-4 text-3xl font-bold tracking-tight text-[#092c23]">{bundle.name}</h1><p className="mt-4 text-text-medium">{bundle.description}</p>
          <p className="mt-6 text-3xl font-bold text-[#005b39]">{bundle.bundlePrice === null ? "Price coming soon" : formatNairaAmount(bundle.bundlePrice)}</p><del className="my-2 block text-text-muted">{formatNairaAmount(bundle.regularPrice)} bought separately</del><BundleSavingsBadge bundle={bundle} />
          <p className="mt-4 text-sm text-text-medium">{bundle.items.length} products · {bundle.itemCount} items per bundle</p>
          <div className="mt-6 flex flex-wrap gap-3"><div className="flex min-h-12 items-center rounded-xl border border-[#e0e7e2]"><button className="min-h-12 px-5" aria-label="Decrease bundle quantity" disabled={quantity <= 1} onClick={() => setQuantity((n) => Math.max(1, n - 1))}>−</button><span className="px-3">{quantity}</span><button className="min-h-12 px-5 disabled:opacity-30" aria-label="Increase bundle quantity" disabled={quantity >= bundle.availableQuantity} onClick={() => setQuantity((n) => n + 1)}>+</button></div><Button className="min-h-12 flex-1" disabled={!bundle.isAvailable} onClick={() => { if (addBundleToCart(bundle, quantity)) setNotice(`${quantity} × ${bundle.name} added to your cart`); }}>{bundle.isAvailable ? "Add Bundle to Cart" : "Bundle unavailable"}</Button></div>
          <p className="mt-3 text-sm text-text-muted">{bundle.isAvailable ? `${bundle.availableQuantity} bundles available` : "One or more included products are unavailable."}</p><p role="status" aria-live="polite" className="mt-3 text-sm text-primary">{notice}</p>
        </div>
      </div>
      <section className="mt-10" aria-labelledby="inside-title"><h2 id="inside-title" className="mb-4 text-2xl font-bold text-[#092c23]">What&apos;s Inside</h2><div className="grid gap-3 sm:grid-cols-2">{bundle.items.map((item) => <Link key={item.productId} href={`/marketplace/${item.productId}`} className="flex items-center gap-4 rounded-2xl border border-[#e7ede8] p-4">{/* eslint-disable-next-line @next/next/no-img-element */}<img src={item.imageUrl} alt={item.name} className="h-20 w-20 object-contain" loading="lazy" /><div className="min-w-0 flex-1"><p className="font-semibold text-[#092c23]">{item.name}</p><p className="text-sm text-text-muted">{item.unit}</p></div><span className="font-semibold text-primary">×{item.quantity}</span></Link>)}</div></section>
    </>}
  </main></>;
}
