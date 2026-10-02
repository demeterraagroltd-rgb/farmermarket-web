"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { type Bundle, addBundleToCart } from "../../lib/bundles";
import { formatNairaAmount } from "../../lib/format";
import { Button } from "../ui/Button";

export function BundleSavingsBadge({ bundle }: { bundle: Bundle }) {
  return bundle.savings > 0 ? <span className="inline-block rounded-full bg-[#fff2d4] px-3 py-1 text-sm text-[#9c5700]">Save {formatNairaAmount(bundle.savings)} · {bundle.savingsPercent}%</span> : null;
}

export function BundleCard({ bundle, onAdded }: { bundle: Bundle; onAdded: (name: string) => void }) {
  const [favorite, setFavorite] = useState(false);
  const key = `bundle:${bundle.id}`;
  useEffect(() => {
    try { const ids = JSON.parse(localStorage.getItem("farmermarket_favorites") ?? "[]"); setFavorite(Array.isArray(ids) && ids.includes(key)); } catch { /* No favorites yet. */ }
  }, [key]);
  function toggleFavorite() {
    let ids: string[] = [];
    try { const saved = JSON.parse(localStorage.getItem("farmermarket_favorites") ?? "[]"); if (Array.isArray(saved)) ids = saved; } catch { /* Reset invalid saved data. */ }
    localStorage.setItem("farmermarket_favorites", JSON.stringify(favorite ? ids.filter((id) => id !== key) : [...new Set([...ids, key])]));
    setFavorite(!favorite);
  }
  return <article className="flex min-w-0 flex-col rounded-[22px] border border-[#e7ede8] bg-white p-4 shadow-[0_6px_18px_#12392308]">
    <div className="relative rounded-2xl bg-[#fafaf8]">
      <Link href={`/marketplace/bundles/${bundle.slug}`} aria-label={`View ${bundle.name}`}>
        {bundle.imageUrl ? <>{/* eslint-disable-next-line @next/next/no-img-element */}<img src={bundle.imageUrl} alt={bundle.name} className="h-56 w-full object-contain p-4" loading="lazy" /></> : <div className="flex h-56 items-center justify-center text-sm text-text-muted">Bundle image coming soon</div>}
      </Link>
      <button onClick={toggleFavorite} aria-label={`${favorite ? "Remove" : "Save"} ${bundle.name} ${favorite ? "from" : "to"} favorites`} aria-pressed={favorite} className="absolute right-2 top-2 rounded-full bg-white p-2 text-[#005b39]">
        <svg width="24" height="24" viewBox="0 0 24 24" fill={favorite ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z" /></svg>
      </button>
    </div>
    <Link href={`/marketplace/bundles/${bundle.slug}`} className="mt-4 text-lg font-semibold text-[#092c23]">{bundle.name}</Link>
    <p className="mt-1 text-sm text-text-medium">{bundle.items.map((i) => i.name).join(" • ")}</p>
    <p className="mt-2 text-xs text-text-muted">{bundle.items.length} products · {bundle.itemCount} items</p>
    <div className="mt-auto pt-3"><p className="text-2xl font-bold text-[#005b39]">{bundle.bundlePrice === null ? "Price coming soon" : formatNairaAmount(bundle.bundlePrice)}</p><del className="mb-2 block text-sm text-text-muted">{formatNairaAmount(bundle.regularPrice)}</del><BundleSavingsBadge bundle={bundle} /></div>
    <div className="mt-4 grid grid-cols-2 gap-2"><Link href={`/marketplace/bundles/${bundle.slug}`} className="flex min-h-11 items-center justify-center rounded-lg border border-[#00633f] px-2 text-sm font-semibold text-[#00633f]">View Bundle</Link><Button disabled={!bundle.isAvailable} onClick={() => { if (addBundleToCart(bundle)) onAdded(bundle.name); }}>{bundle.isAvailable ? "Add Bundle" : "Unavailable"}</Button></div>
  </article>;
}

export function BundleGrid({ bundles, onAdded }: { bundles: Bundle[]; onAdded: (name: string) => void }) {
  return <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">{bundles.map((bundle) => <BundleCard key={bundle.id} bundle={bundle} onAdded={onAdded} />)}</div>;
}
