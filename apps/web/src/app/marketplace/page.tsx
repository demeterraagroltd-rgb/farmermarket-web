"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { SiteHeader } from "../../components/site/SiteHeader";
import { formatNairaAmount } from "../../lib/format";
import { effectivePrice, type Category, type Product } from "../../lib/catalog";
import { fetchBundles, type Bundle } from "../../lib/bundles";
import { BundleGrid } from "../../components/marketplace/BundleCard";
import { addToCart, getCart, totalsOf } from "../../lib/cart";

function Icon({ name }: { name: "search" | "cart" | "user" | "heart" | "grid" | "bag" }) {
  const paths = {
    search: <><circle cx="10.5" cy="10.5" r="7.5" /><path d="m16 16 5 5" /></>,
    cart: <><path d="M2 3h3l3 13h11l3-10H6" /><circle cx="9" cy="21" r="1" /><circle cx="19" cy="21" r="1" /></>,
    user: <><circle cx="12" cy="7" r="4" /><path d="M3 22v-3a9 9 0 0 1 18 0v3" /></>,
    heart: <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z" />,
    grid: <><rect x="3" y="3" width="6" height="6" rx="1" /><rect x="15" y="3" width="6" height="6" rx="1" /><rect x="3" y="15" width="6" height="6" rx="1" /><rect x="15" y="15" width="6" height="6" rx="1" /></>,
    bag: <><path d="M5 7h14l2 14H3L5 7Z" /><path d="M8 8V6a4 4 0 0 1 8 0v2" /></>,
  };
  return <svg width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0">{paths[name]}</svg>;
}

function ProductTile({ product, onAdded }: { product: Product; onAdded: (name: string) => void }) {
  const [quantity, setQuantity] = useState(1);
  const [favorite, setFavorite] = useState(false);
  useEffect(() => {
    try { const saved = JSON.parse(localStorage.getItem("farmermarket_favorites") ?? "[]"); setFavorite(Array.isArray(saved) && saved.includes(product.id)); } catch { /* No saved favorites. */ }
  }, [product.id]);
  function toggleFavorite() {
    let saved: string[] = [];
    try { const value = JSON.parse(localStorage.getItem("farmermarket_favorites") ?? "[]"); if (Array.isArray(value)) saved = value; } catch { /* Reset invalid data. */ }
    localStorage.setItem("farmermarket_favorites", JSON.stringify(favorite ? saved.filter((id) => id !== product.id) : [...new Set([...saved, product.id])]));
    setFavorite(!favorite);
  }
  return <article className="min-w-0 rounded-[22px] border border-[#e7ede8] bg-white p-3 shadow-[0_6px_18px_#12392308] transition-shadow hover:shadow-lg sm:p-4">
    <div className="relative mb-5 rounded-2xl bg-gradient-to-b from-white to-[#faf9f6]">
      <Link href={`/marketplace/${product.id}`} aria-label={`View ${product.name}`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={product.imageUrl} alt={product.name} loading="lazy" className="h-40 w-full object-contain px-3 pb-3 sm:h-56" />
      </Link>
      <button className={`absolute right-0 top-0 rounded-full bg-white/90 p-2 ${favorite ? "text-[#008753]" : "text-[#17231c]"}`} onClick={toggleFavorite} aria-label={`${favorite ? "Remove" : "Save"} ${product.name} ${favorite ? "from" : "to"} favorites`} aria-pressed={favorite}><Icon name="heart" /></button>
      <span className="absolute -bottom-2 left-0 rounded-full border-2 border-white bg-[#fff2d4] px-3 py-1 text-xs text-[#9c5700] sm:text-sm">{product.unit}</span>
    </div>
    <Link href={`/marketplace/${product.id}`} className="block text-sm leading-snug text-[#101811] sm:text-lg">{product.name}</Link>
    <div className="mb-3 mt-1 text-xl font-bold tracking-tight text-[#005b39] sm:text-2xl">{formatNairaAmount(effectivePrice(product))}{product.discountPrice !== null && <del className="ml-2 text-xs font-normal text-gray-500">{formatNairaAmount(product.price)}</del>}</div>
    <div className="flex flex-wrap items-center gap-2 lg:flex-nowrap">
      <div className="flex h-11 flex-1 items-center justify-between rounded-2xl border border-[#e0e7e2] lg:basis-[38%]">
        <button className="px-3 py-2 text-xl disabled:opacity-30" aria-label={`Decrease quantity of ${product.name}`} disabled={quantity === 1} onClick={() => setQuantity((n) => Math.max(1, n - 1))}>−</button><span>{quantity}</span><button className="px-3 py-2 text-xl" aria-label={`Increase quantity of ${product.name}`} onClick={() => setQuantity((n) => n + 1)}>+</button>
      </div>
      <button className="flex h-11 basis-full items-center justify-center gap-2 whitespace-nowrap rounded-2xl bg-gradient-to-r from-[#006442] to-[#007c4b] px-3 text-xs font-semibold text-white hover:from-[#004c32] disabled:opacity-50 lg:flex-1 lg:basis-auto" disabled={!product.isAvailable || product.stockQuantity < 1} onClick={() => { addToCart({ id: product.id, name: product.name, imageUrl: product.imageUrl, unit: product.unit, price: effectivePrice(product) }, quantity); onAdded(product.name); }}><Icon name="cart" />{product.isAvailable && product.stockQuantity > 0 ? "Add to Cart" : "Sold out"}</button>
    </div>
  </article>;
}

export default function MarketplacePage() {
  const [products, setProducts] = useState<Product[] | null>(null);
  const [bundles, setBundles] = useState<Bundle[] | null>(null);
  const [bundleError, setBundleError] = useState("");
  const [categories, setCategories] = useState<Category[]>([]);
  const [activeCategory, setActiveCategory] = useState("");
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [cartCount, setCartCount] = useState(0);
  const [notice, setNotice] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setQuery(params.get("q") ?? "");
    setActiveCategory(params.get("category") ?? "");
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    setError(null); setBundleError("");
    fetchBundles(controller.signal).then(setBundles).catch((err) => { if (!controller.signal.aborted) setBundleError(err instanceof Error ? err.message : "Unable to load bundles."); });
    const base = process.env.NEXT_PUBLIC_API_URL;
    fetch(`${base}/v1/catalog/products`, { signal: controller.signal }).then(async (res) => {
      if (!res.ok) throw new Error("We couldn't load the groceries. Please try again.");
      setProducts(await res.json());
    }).catch((err) => { if (!controller.signal.aborted) setError(err instanceof Error ? err.message : "Unable to load products."); });
    fetch(`${base}/v1/catalog/categories`, { signal: controller.signal }).then((res) => res.ok ? res.json() : []).then(setCategories).catch(() => {});
    return () => controller.abort();
  }, [attempt]);
  useEffect(() => {
    const sync = () => setCartCount(totalsOf(getCart()).itemCount);
    sync(); window.addEventListener("farmermarket:cart", sync); window.addEventListener("storage", sync);
    return () => { window.removeEventListener("farmermarket:cart", sync); window.removeEventListener("storage", sync); };
  }, []);
  useEffect(() => { if (!notice) return; const timer = setTimeout(() => setNotice(""), 2500); return () => clearTimeout(timer); }, [notice]);
  const visibleProducts = useMemo(() => products?.filter((p) => (!activeCategory || p.category === activeCategory) && `${p.name} ${p.brand} ${p.category}`.toLowerCase().includes(query.toLowerCase().trim())), [products, activeCategory, query]);

  return <><SiteHeader /><main className="min-h-screen bg-white px-4 pb-16 pt-5 text-[#092c23] sm:px-6"><div className="mx-auto max-w-[1120px]">
    <div className="mb-4 flex items-center gap-3 sm:gap-5">
      <label className="flex min-w-0 flex-1 items-center gap-3 rounded-full bg-[#f3f4f3] px-4 py-4 focus-within:ring-2 focus-within:ring-[#006440] sm:px-6"><Icon name="search" /><input type="search" placeholder="Search for products (e.g. rice, oil, beans...)" aria-label="Search products" value={query} onChange={(e) => setQuery(e.target.value)} className="w-full bg-transparent text-sm outline-none sm:text-base" /></label>
      <Link href="/cart" className="relative flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[#f0f2f0] sm:h-14 sm:w-14" aria-label={`Shopping cart, ${cartCount} items`}><Icon name="cart" />{cartCount > 0 && <span className="absolute -right-1 -top-1 flex h-6 min-w-6 items-center justify-center rounded-full border-2 border-white bg-[#f7b731] px-1 text-xs text-white">{cartCount}</span>}</Link>
      <Link href="/account" className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[#f0f2f0] sm:h-14 sm:w-14" aria-label="My account"><Icon name="user" /></Link>
    </div>
    <h1 className="sr-only">Farmer Market groceries</h1>
    <a href="#products" className="block overflow-hidden rounded-2xl sm:rounded-3xl" aria-label="Quality groceries for every home. Shop now.">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/marketplace-hero.png" alt="Quality Groceries for Every Home. Fresh. Affordable. Delivered to you. Shop Now." fetchPriority="high" className="block h-auto w-full" />
    </a>
    <nav className="flex gap-3 overflow-x-auto pb-2 pt-5" aria-label="Product categories">
      {[{ id: "all", name: "" }, { id: "bundles", name: "Bundles" }, ...categories.filter((c) => c.name !== "Bundles")].map((c) => <button key={c.id} className={`flex shrink-0 items-center gap-3 rounded-full px-6 py-3 text-sm ${activeCategory === c.name ? "bg-[#00633f] text-white" : "bg-[#f3f5f3] text-[#092c23]"}`} aria-pressed={activeCategory === c.name} onClick={() => setActiveCategory(c.name)}><Icon name={c.name ? "bag" : "grid"} />{c.name || "All"}</button>)}
    </nav>
    {!activeCategory && !query && bundles?.some((b) => b.featured) && <section className="mt-7" aria-labelledby="featured-bundles-title"><h2 id="featured-bundles-title" className="text-2xl font-bold text-[#092c23]">Save More With Bundles</h2><p className="mb-5 mt-2 text-sm text-text-medium">Everyday essentials grouped together for easier shopping.</p><BundleGrid bundles={bundles.filter((b) => b.featured).slice(0, 3)} onAdded={(name) => setNotice(`${name} added to your cart`)} /></section>}
    <section id="products" className="scroll-mt-24" aria-labelledby="products-title">
      <div className="mb-5 mt-6 flex items-center justify-between gap-4"><h2 id="products-title" className="text-2xl font-bold tracking-tight text-[#111] sm:text-3xl">{query ? "Search results" : activeCategory || "Popular Products"}</h2><button className="whitespace-nowrap text-sm font-semibold text-[#005b39]" onClick={() => { setActiveCategory(""); setQuery(""); }}>See All <span aria-hidden="true" className="ml-2">→</span></button></div>
      {activeCategory === "Bundles" ? bundleError ? <div role="alert" className="rounded-2xl bg-[#f6f8f6] p-10 text-center">{bundleError}<button className="ml-3 underline" onClick={() => setAttempt((n) => n + 1)}>Try again</button></div> : bundles === null ? <p role="status">Loading bundles?</p> : bundles.filter((b) => `${b.name} ${b.description} ${b.items.map((i) => i.name).join(" ")}`.toLowerCase().includes(query.toLowerCase().trim())).length ? <BundleGrid bundles={bundles.filter((b) => `${b.name} ${b.description} ${b.items.map((i) => i.name).join(" ")}`.toLowerCase().includes(query.toLowerCase().trim()))} onAdded={(name) => setNotice(`${name} added to your cart`)} /> : <p className="rounded-2xl bg-[#f6f8f6] p-10 text-center">{query ? "No bundles match your search." : "Our grocery bundles are being prepared. Check back soon."}</p> : error ? <div className="rounded-2xl bg-[#f6f8f6] p-10 text-center" role="alert"><p>{error}</p><button className="mt-4 underline" onClick={() => setAttempt((n) => n + 1)}>Try again</button></div> : products === null ? <div className="grid grid-cols-2 gap-4 md:grid-cols-3" aria-label="Loading products" aria-busy="true">{Array.from({ length: 6 }, (_, i) => <div key={i} className="h-80 animate-pulse rounded-3xl bg-[#f2f5f2] motion-reduce:animate-none" />)}</div> : visibleProducts?.length === 0 ? <div className="rounded-2xl bg-[#f6f8f6] p-10 text-center">No groceries match your search. Try another product or category.</div> : <div className="grid grid-cols-2 gap-3 md:grid-cols-3 sm:gap-5">{visibleProducts?.map((p) => <ProductTile key={p.id} product={p} onAdded={(name) => setNotice(`${name} added to your cart`)} />)}</div>}
    </section>
    <div className={notice ? "fixed bottom-6 left-1/2 z-50 w-max max-w-[90%] -translate-x-1/2 rounded-full bg-[#004c32] px-6 py-3 text-center text-sm text-white shadow-lg" : "sr-only"} role="status" aria-live="polite">{notice}</div>
  </div></main></>;
}
