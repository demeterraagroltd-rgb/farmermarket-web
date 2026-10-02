"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { effectivePrice, type Category, type Product } from "../../lib/catalog";
import { fetchBundles, type Bundle } from "../../lib/bundles";
import { formatNairaAmount } from "../../lib/format";
import { getCustomerSession, type CustomerSession } from "../../lib/customer";
import { CartLink } from "./CartLink";
import { CartIcon, LeafIcon, WalletIcon } from "../ui/icons";

const actionClass = "inline-flex min-h-11 items-center justify-center rounded-md bg-gold px-5 py-2.5 text-sm font-semibold text-text-dark transition-colors hover:bg-gold-light focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";
const categoryHref = (name: string) => `/marketplace?category=${encodeURIComponent(name)}`;

export function HomeStorefront() {
  const [products, setProducts] = useState<Product[] | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [bundles, setBundles] = useState<Bundle[] | null>(null);
  const [error, setError] = useState("");
  const [bundleError, setBundleError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [session, setSession] = useState<CustomerSession | null>(null);

  useEffect(() => {
    const sync = () => setSession(getCustomerSession());
    sync();
    window.addEventListener("storage", sync);
    window.addEventListener("farmermarket:session", sync);
    return () => {
      window.removeEventListener("storage", sync);
      window.removeEventListener("farmermarket:session", sync);
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const base = process.env.NEXT_PUBLIC_API_URL;
    setError("");
    setBundleError("");
    fetch(`${base}/v1/catalog/products`, { signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error("We couldn't load the groceries. Please try again.");
        setProducts(await res.json());
      }).catch((err) => { if (!controller.signal.aborted) setError(err.message); });
    fetch(`${base}/v1/catalog/categories`, { signal: controller.signal })
      .then((res) => res.ok ? res.json() : [])
      .then((items) => { if (!controller.signal.aborted) setCategories(items); })
      .catch(() => {});
    fetchBundles(controller.signal).then(setBundles)
      .catch(() => { if (!controller.signal.aborted) setBundleError("We couldn't load the bundles."); });
    return () => controller.abort();
  }, [attempt]);

  const featured = products ? [...products].sort((a, b) =>
    Number(!!b.tags?.includes("homepage-featured")) - Number(!!a.tags?.includes("homepage-featured"))
  ).slice(0, 6) : [];
  const shoppingCategories = categories.filter((c) => c.name !== "Bundles").slice(0, 5);
  const creditHref = session ? session.verificationStatus === "unverified" || session.verificationStatus === "needs_more_info" ? "/apply" : "/account" : "/apply";
  const creditLabel = !session ? "Apply for credit" : session.verificationStatus === "unverified" ? "Continue application" : session.verificationStatus === "needs_more_info" ? "Update application" : session.verificationStatus === "verified" ? "View your credit" : "View application status";
  const featuredBundles = bundles ? [...bundles].sort((a, b) => Number(b.featured) - Number(a.featured)).slice(0, 3) : [];

  return <>
    <div className="bg-[#005b39] px-4 py-2 text-center text-xs font-medium text-white">Everyday groceries. Flexible ways to pay.</div>
    <header className="sticky top-0 z-30 border-b border-gray-200 bg-white shadow-sm">
      <div className="mx-auto flex max-w-[1320px] flex-wrap items-center gap-4 px-4 py-4 sm:px-6">
        <Link href="/" className="flex shrink-0 items-center gap-2 text-xl font-bold text-[#005b39]">
          <Image src="/icon.png" width={32} height={32} alt="" />Farmer Market
        </Link>
        <form action="/marketplace" className="order-last flex w-full min-w-0 rounded-md border border-gray-300 focus-within:ring-2 focus-within:ring-primary md:order-none md:ml-5 md:w-auto md:flex-1" role="search">
          <label htmlFor="home-search" className="sr-only">Search groceries</label>
          <input id="home-search" name="q" type="search" placeholder="Search rice, cooking oil, beans and more" className="min-w-0 flex-1 rounded-l-md px-4 py-3 text-sm outline-none" />
          <button className={actionClass + " rounded-l-none"} type="submit">Search</button>
        </form>
        <div className="ml-auto flex items-center gap-4 text-sm font-medium">
          <Link href={session ? "/account" : "/account/login"} className="hover:text-primary">{session ? "My account" : "Sign in"}</Link>
          <a href="#help" className="hidden hover:text-primary sm:block">Help</a>
          <CartLink />
        </div>
      </div>
      <nav className="flex justify-start gap-6 overflow-x-auto border-t border-gray-100 px-4 py-3 text-xs font-medium sm:justify-center sm:text-sm" aria-label="Main navigation">
        <Link href="/marketplace" className="shrink-0 hover:text-primary">Shop groceries</Link>
        <Link href={categoryHref("Bundles")} className="shrink-0 hover:text-primary">Bundles</Link>
        <a href="#how-it-works" className="shrink-0 hover:text-primary">How credit works</a>
        <a href="#plans" className="shrink-0 hover:text-primary">Payment plans</a>
      </nav>
    </header>

    <div className="mx-auto w-full max-w-[1320px] space-y-5 px-4 py-5 sm:px-6">
      <div className="grid gap-4 lg:grid-cols-[190px_minmax(0,1fr)_220px]">
        <nav className="hidden rounded-lg border border-gray-200 bg-white p-2 lg:block" aria-label="Grocery categories">
          <Link href="/marketplace" className="flex items-center gap-3 rounded-md px-3 py-3 text-sm font-semibold hover:bg-green-50"><CartIcon className="h-5 w-5" />All groceries</Link>
          {shoppingCategories.map((c) => <Link key={c.id} href={categoryHref(c.name)} className="flex items-center gap-3 rounded-md px-3 py-3 text-sm hover:bg-green-50"><LeafIcon className="h-5 w-5 shrink-0 text-primary" />{c.name}</Link>)}
          <Link href={categoryHref("Bundles")} className="flex items-center gap-3 rounded-md px-3 py-3 text-sm hover:bg-green-50"><CartIcon className="h-5 w-5" />Family bundles</Link>
        </nav>
        <section className="relative isolate min-h-64 overflow-hidden rounded-lg bg-[#005b39] sm:min-h-80" aria-labelledby="home-hero-title">
          <Image src="/homepage-groceries.png" alt="" fill priority sizes="(min-width: 1024px) 760px, 100vw" className="-z-20 object-cover object-right" />
          <div className="absolute inset-0 -z-10 bg-gradient-to-r from-[#005b39]/95 via-[#005b39]/70 to-transparent" />
          <div className="max-w-md px-6 py-9 text-white sm:px-8 sm:py-12">
            <h1 id="home-hero-title" className="text-4xl font-extrabold leading-tight tracking-tight sm:text-5xl">Stock up<br /><span className="text-gold-light">for the month.</span></h1>
            <p className="mt-4 max-w-64 text-sm sm:text-base">Everyday essentials, all in one place.</p>
            <Link href="/marketplace" className={actionClass + " mt-6"}>Shop groceries</Link>
          </div>
        </section>
        <aside className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
          <div className="rounded-lg border border-gray-200 bg-white p-5">
            <WalletIcon className="mb-3 h-7 w-7 text-primary" />
            <h2 className="font-bold text-text-dark">Grocery credit</h2>
            <p className="mt-2 text-sm text-text-medium">{session?.verificationStatus === "submitted" ? "Your application is under review. Follow its progress from your account." : session?.verificationStatus === "verified" ? "Check your available credit and choose your next groceries." : "Apply for a limit. Shop after approval."}</p>
            <Link href={creditHref} className={actionClass + " mt-4 w-full px-2 text-center"}>{creditLabel}</Link>
            <p className="mt-2 text-center text-xs text-text-muted">Credit subject to approval.</p>
          </div>
          <div className="rounded-lg border border-gray-200 bg-white p-5">
            <h2 className="font-bold text-text-dark">Need help?</h2>
            <p className="mt-2 text-sm text-text-medium">Find answers about shopping, verification and payment plans.</p>
            <a href="#help" className="mt-3 inline-block text-sm font-semibold text-primary hover:underline">Visit our help section →</a>
          </div>
        </aside>
      </div>

      {shoppingCategories.length > 0 && <nav className="grid grid-cols-3 gap-2 sm:grid-cols-6 sm:gap-3" aria-label="Shop by category">
        {[...shoppingCategories, { id: "bundles", name: "Bundles" }].map((c) => {
          const photo = c.name === "Bundles" ? featuredBundles[0]?.imageUrl : products?.find((p) => p.category === c.name)?.imageUrl;
          return <Link key={c.id} href={categoryHref(c.name)} className="flex flex-col items-center justify-center gap-2 rounded-lg border border-gray-200 bg-white p-3 text-center text-sm font-semibold transition-shadow hover:shadow-md">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {photo ? <img src={photo} alt="" loading="lazy" className="h-20 w-full object-contain" /> : <LeafIcon className="m-5 h-10 w-10 text-primary" />}
            {c.name}
          </Link>;
        })}
      </nav>}

      <section className="overflow-hidden rounded-lg border border-gray-200 bg-white" aria-labelledby="popular-title">
        <div className="flex items-center justify-between gap-4 bg-[#005b39] px-4 py-3 text-white">
          <h2 id="popular-title" className="text-lg font-bold">Popular groceries</h2>
          <Link href="/marketplace" className="text-sm hover:underline">See all →</Link>
        </div>
        {error ? <div role="alert" className="p-8 text-center"><p>{error}</p><button className="mt-3 font-semibold text-primary underline" onClick={() => setAttempt((n) => n + 1)}>Try again</button></div> :
          products === null ? <div className="grid grid-cols-2 gap-3 p-3 sm:grid-cols-3 xl:grid-cols-6" aria-busy="true" aria-label="Loading groceries">{Array.from({ length: 6 }, (_, i) => <div key={i} className="h-64 animate-pulse rounded-md bg-gray-100 motion-reduce:animate-none" />)}</div> :
          featured.length === 0 ? <p className="p-8 text-center text-text-muted">Groceries are being prepared. Check back soon.</p> :
          <div className="grid grid-cols-2 gap-3 p-3 sm:grid-cols-3 xl:grid-cols-6">{featured.map((p) => <article key={p.id} className="flex min-w-0 flex-col rounded-md border border-gray-100 p-2 transition-shadow hover:shadow-md">
            <Link href={`/marketplace/${p.id}`} aria-label={`View ${p.name}`}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.imageUrl} alt={p.name} loading="lazy" className="h-36 w-full object-contain sm:h-40" />
            </Link>
            <Link href={`/marketplace/${p.id}`} className="mt-3 line-clamp-2 text-sm font-medium">{p.name}</Link>
            <p className="mt-1 text-xs text-text-muted">{p.unit}</p>
            <p className="mt-1 font-bold text-[#005b39]">{formatNairaAmount(effectivePrice(p))}</p>
            {(!p.isAvailable || p.stockQuantity < 1) && <p className="text-xs text-text-muted">Currently unavailable</p>}
            <div className="mt-auto pt-3"><Link href={`/marketplace/${p.id}`} className={actionClass + " w-full px-2"}>View product</Link></div>
          </article>)}</div>}
      </section>

      <section className="overflow-hidden rounded-lg border border-gray-200 bg-white" aria-labelledby="bundles-title">
        <div className="flex items-center justify-between gap-4 bg-gold-light/40 px-4 py-3">
          <h2 id="bundles-title" className="text-lg font-bold">Bundles for your household</h2>
          <Link href={categoryHref("Bundles")} className="text-sm font-medium hover:underline">See all →</Link>
        </div>
        {bundleError ? <div role="alert" className="p-6 text-center">{bundleError} <button className="text-primary underline" onClick={() => setAttempt((n) => n + 1)}>Try again</button></div> :
          bundles === null ? <p role="status" className="p-6 text-text-muted">Loading household bundles…</p> :
          featuredBundles.length === 0 ? <p className="p-6 text-text-muted">Our grocery bundles are being prepared. Check back soon.</p> :
          <div className="grid gap-3 p-3 md:grid-cols-3">{featuredBundles.map((b) => <Link key={b.id} href={`/marketplace/bundles/${b.slug}`} className="flex min-w-0 gap-3 rounded-md border border-gray-100 p-3 hover:shadow-md">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {b.imageUrl ? <img src={b.imageUrl} alt="" loading="lazy" className="h-32 w-28 shrink-0 object-contain" /> : <CartIcon className="m-6 h-12 w-12 shrink-0 text-primary" />}
            <div className="flex min-w-0 flex-col items-start"><h3 className="font-semibold">{b.name}</h3><p className="mt-2 line-clamp-2 text-xs text-text-medium">{b.description || b.items.map((i) => i.name).join(", ")}</p><p className="my-2 text-sm font-bold text-primary">{b.bundlePrice === null ? "Price coming soon" : formatNairaAmount(b.bundlePrice)}</p><span className="mt-auto rounded-md bg-gold px-3 py-2 text-xs font-semibold text-text-dark">Explore bundle</span></div>
          </Link>)}</div>}
      </section>
    </div>
  </>;
}
