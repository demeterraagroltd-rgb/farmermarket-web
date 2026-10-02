"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { SiteHeader } from "../../../components/site/SiteHeader";
import { formatNairaAmount } from "../../../lib/format";
import { effectivePrice, fetchProduct, type Product } from "../../../lib/catalog";
import { addToCart } from "../../../lib/cart";

type DetailedProduct = Product & { imageUrls?: string[]; specifications?: Record<string, string> };
function Icon({ kind }: { kind: "box" | "heart" | "cart" | "check" | "pin" | "leaf" | "card" }) {
  const paths = {
    box: <><path d="m12 2 9 5v10l-9 5-9-5V7l9-5Zm-9 5 9 5 9-5M12 12v10M7 4.8l9 5v4" /></>,
    heart: <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z" />,
    cart: <><path d="M2 3h3l3 13h11l3-10H6" /><circle cx="9" cy="21" r="1" /><circle cx="19" cy="21" r="1" /></>,
    check: <><path d="m12 2 9 4v6c0 5-9 10-9 10S3 17 3 12V6l9-4Z" /><path d="m8 12 3 3 5-6" /></>,
    pin: <><path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 0 1 16 0Z" /><circle cx="12" cy="10" r="3" /></>,
    leaf: <><path d="M21 3C7 1 1 8 5 16s17 5 16-13Z" /><path d="M3 22 17 8" /></>,
    card: <><rect x="2" y="4" width="20" height="16" rx="3" /><path d="M2 9h20M6 15h4" /></>,
  };
  return <svg width="27" height="27" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[kind]}</svg>;
}

export default function ProductDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [product, setProduct] = useState<DetailedProduct | null | undefined>();
  const [error, setError] = useState<string | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [added, setAdded] = useState(false);
  const [selected, setSelected] = useState(0);
  const [favorite, setFavorite] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let current = true;
    setError(null); setProduct(undefined); setQuantity(1); setAdded(false); setSelected(0);
    fetchProduct(id).then((value) => { if (current) setProduct(value); }).catch((err) => { if (current) setError(err instanceof Error ? err.message : "Unable to load this product."); });
    try { const saved = JSON.parse(localStorage.getItem("farmermarket_favorites") ?? "[]"); setFavorite(Array.isArray(saved) && saved.includes(id)); } catch { setFavorite(false); }
    return () => { current = false; };
  }, [id, attempt]);

  function toggleFavorite() {
    let saved: string[] = [];
    try { const value = JSON.parse(localStorage.getItem("farmermarket_favorites") ?? "[]"); if (Array.isArray(value)) saved = value; } catch { /* Reset malformed favorites. */ }
    localStorage.setItem("farmermarket_favorites", JSON.stringify(favorite ? saved.filter((item) => item !== id) : [...new Set([...saved, id])]));
    setFavorite(!favorite);
  }
  const images = product ? [...new Set([product.imageUrl, ...(product.imageUrls ?? [])].filter(Boolean))] : [];
  const price = product ? effectivePrice(product) : 0;
  const details: Record<string, string> = product ? { Brand: product.brand, Size: product.unit, Category: product.category, ...product.specifications } : {};

  return <><SiteHeader /><main className="min-h-screen bg-white px-4 py-6 text-[#092c23] sm:px-6 sm:py-8"><div className="mx-auto max-w-[1240px]">
    <Link href="/marketplace" className="mb-6 inline-flex items-center gap-2 text-sm font-medium text-[#547366] hover:text-[#005b39]">← Back to groceries</Link>
    {error ? <div className="rounded-3xl bg-[#f3f8f4] p-10 text-center" role="alert"><p>{error}</p><button className="mt-4 font-semibold underline" onClick={() => setAttempt((n) => n + 1)}>Try again</button></div> : product === undefined ? <div className="grid gap-8 md:grid-cols-2" aria-label="Loading product" aria-busy="true"><div className="aspect-square animate-pulse rounded-3xl bg-[#f1f5f1] motion-reduce:animate-none" /><div className="h-96 animate-pulse rounded-3xl bg-[#f1f5f1] motion-reduce:animate-none" /></div> : product === null ? <div className="rounded-3xl bg-[#f3f8f4] p-10 text-center">This product is no longer available. <Link href="/marketplace" className="underline">Browse other groceries</Link>.</div> : <div className="grid items-start gap-8 md:grid-cols-[1.15fr_1fr] lg:gap-10">
      <div>
        <div className="relative overflow-hidden rounded-[24px] bg-[#f7f6f2]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={images[selected]} alt={product.name} className="aspect-square w-full object-contain p-6 sm:p-10" fetchPriority="high" />
          <button className={`absolute right-5 top-5 flex h-12 w-12 items-center justify-center rounded-full bg-white shadow-sm ${favorite ? "text-[#008753]" : "text-[#092c23]"}`} aria-label={favorite ? "Remove from favorites" : "Save to favorites"} aria-pressed={favorite} onClick={toggleFavorite}><Icon kind="heart" /></button>
          {images.length > 1 && <><button className="absolute left-4 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white text-3xl shadow-sm" aria-label="Previous product photo" onClick={() => setSelected((n) => (n - 1 + images.length) % images.length)}>‹</button><button className="absolute right-4 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white text-3xl shadow-sm" aria-label="Next product photo" onClick={() => setSelected((n) => (n + 1) % images.length)}>›</button><div className="absolute bottom-5 left-1/2 flex -translate-x-1/2 gap-2">{images.map((_, i) => <button key={i} className={`h-3 w-3 rounded-full border-2 border-white ${selected === i ? "bg-[#006440]" : "bg-[#d7cec2]"}`} aria-label={`Show product photo ${i + 1}`} aria-pressed={selected === i} onClick={() => setSelected(i)} />)}</div></>}
        </div>
        {images.length > 1 && <div className="mt-4 grid grid-cols-4 gap-3">{images.map((image, i) => <button key={image} onClick={() => setSelected(i)} aria-label={`Show product photo ${i + 1}`} aria-pressed={selected === i} className={`overflow-hidden rounded-2xl border-2 p-1 ${selected === i ? "border-[#006440]" : "border-transparent"}`}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={image} alt={`${product.name}, view ${i + 1}`} className="aspect-square w-full rounded-xl bg-[#f7f6f2] object-contain" />
        </button>)}</div>}
      </div>
      <div>
        {product.brand && <span className="inline-block rounded-2xl bg-[#e4f3eb] px-4 py-2 text-sm font-semibold text-[#005b39]">{product.brand}</span>}
        <h1 className="mb-4 mt-3 text-3xl font-bold leading-tight tracking-tight text-[#082b30] lg:text-4xl">{product.name}</h1>
        <span className="inline-block rounded-2xl bg-[#ffedc6] px-5 py-2 text-lg font-semibold text-[#a96b11]">{product.unit}</span>
        <div className="mb-6 mt-5 flex flex-wrap items-baseline gap-3"><p className="text-4xl font-bold tracking-tight text-[#005b39]">{formatNairaAmount(price)}</p>{product.discountPrice !== null && <del className="text-lg text-gray-500">{formatNairaAmount(product.price)}</del>}</div>
        <div className="flex items-center gap-5 rounded-[20px] bg-[#edf7f1] px-6 py-5 text-[#005b39]"><Icon kind="box" /><div><p className="font-semibold">{product.unit}</p><p className="mt-1 text-sm">{formatNairaAmount(price)} per unit</p></div></div>
        {product.description && <p className="my-6 text-base leading-relaxed text-[#6c727a] lg:text-lg">{product.description}</p>}
        <div className="mt-7 flex gap-4">
          <div className="flex h-16 w-[36%] items-center justify-between rounded-[20px] border border-[#d9dfdd] px-2"><button className="p-3 text-xl disabled:opacity-30" disabled={quantity === 1 || !product.isAvailable} aria-label="Decrease quantity" onClick={() => { setQuantity((n) => Math.max(1, n - 1)); setAdded(false); }}>−</button><span className="font-semibold" aria-label="Quantity">{quantity}</span><button className="p-3 text-xl" disabled={!product.isAvailable || product.stockQuantity < quantity} aria-label="Increase quantity" onClick={() => { setQuantity((n) => n + 1); setAdded(false); }}>+</button></div>
          <button className="flex h-16 flex-1 items-center justify-center gap-3 rounded-[20px] bg-gradient-to-r from-[#006442] to-[#007c4b] px-3 font-semibold text-white hover:from-[#004c32] disabled:opacity-50" disabled={!product.isAvailable || product.stockQuantity < quantity} onClick={() => { addToCart({ id: product.id, name: product.name, imageUrl: product.imageUrl, unit: product.unit, price }, quantity); setAdded(true); }}><Icon kind="cart" />{product.isAvailable && product.stockQuantity > 0 ? "Add to Cart" : "Sold out"}</button>
        </div>
        <div role="status" aria-live="polite" className="mt-3 min-h-6 text-sm text-[#006440]">{added && <>{quantity} {quantity === 1 ? "item" : "items"} added. <Link href="/cart" className="font-semibold underline">View cart →</Link></>}</div>
        <div className="mt-3 grid grid-cols-4 rounded-[20px] bg-[#edf7f1] py-5 text-[#005b39]">{([{ kind: "check", label: "Product details" }, { kind: "pin", label: "Centre pickup" }, { kind: "leaf", label: "Groceries" }, { kind: "card", label: "Payment plans" }] as const).map((item) => <div key={item.kind} className="flex flex-col items-center gap-3 border-r border-[#dcece2] px-2 text-center text-xs last:border-0 sm:text-sm"><Icon kind={item.kind} />{item.label}</div>)}</div>
        <h2 className="mb-3 mt-6 text-xl font-bold text-[#082b30]">Product Details</h2>
        <dl className="rounded-[20px] border border-[#e3e8e5] px-5 py-2">{Object.entries(details).filter(([, value]) => value).map(([label, value]) => <div key={label} className="grid grid-cols-2 gap-4 border-b border-[#edf0ee] py-3 text-sm last:border-0"><dt className="text-[#6c727a]">{label}</dt><dd className="text-[#374e43]">{value}</dd></div>)}</dl>
      </div>
    </div>}
  </div></main></>;
}
