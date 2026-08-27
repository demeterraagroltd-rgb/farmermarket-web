"use client";

import { useEffect, useMemo, useState } from "react";
import { Card, EmptyState } from "../../components/ui/Card";
import { formatNaira } from "../../lib/format";

interface Product {
  id: string;
  name: string;
  description: string;
  imageUrl: string;
  priceKobo: string;
  unit: string;
  category: string;
}

interface Category {
  id: string;
  name: string;
}

const ALL = "__all__";

// Public — no auth. The "live product grid" from §11.2's landing page,
// pulled out as its own page for now. Reads GET /v1/catalog/products,
// which only ever returns published + available products, plus
// GET /v1/catalog/categories for the filter chips (§10 — hardcoded in the
// Flutter app today, real here).
export default function MarketplacePage() {
  const [products, setProducts] = useState<Product[] | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [activeCategory, setActiveCategory] = useState<string>(ALL);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const base = process.env.NEXT_PUBLIC_API_URL;
    fetch(`${base}/v1/catalog/products`)
      .then(async (res) => {
        const body = await res.json();
        if (!res.ok) throw new Error(body.message ?? "Failed to load products");
        setProducts(body);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load products"));

    fetch(`${base}/v1/catalog/categories`)
      .then((res) => (res.ok ? res.json() : []))
      .then(setCategories)
      .catch(() => {}); // filter chips are a nicety — a failed fetch just leaves the "All" chip
  }, []);

  const visibleProducts = useMemo(() => {
    if (!products) return null;
    if (activeCategory === ALL) return products;
    return products.filter((p) => p.category === activeCategory);
  }, [products, activeCategory]);

  return (
    <main className="min-h-screen bg-white px-6 py-16">
      <div className="mx-auto max-w-5xl">
        <h1 className="text-3xl font-bold tracking-tight text-text-dark">What you can buy</h1>
        <p className="mt-2 text-text-medium">Every product available with a Farmer Market credit limit.</p>

        {categories.length > 0 && (
          <div className="mt-6 flex flex-wrap gap-2">
            <button
              onClick={() => setActiveCategory(ALL)}
              className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
                activeCategory === ALL
                  ? "bg-primary text-white"
                  : "border border-dark-border/60 text-text-medium hover:bg-surface"
              }`}
            >
              All
            </button>
            {categories.map((c) => (
              <button
                key={c.id}
                onClick={() => setActiveCategory(c.name)}
                className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
                  activeCategory === c.name
                    ? "bg-gold text-white"
                    : "border border-dark-border/60 text-text-medium hover:bg-surface"
                }`}
              >
                {c.name}
              </button>
            ))}
          </div>
        )}

        {error && <p className="mt-6 text-sm text-error">{error}</p>}
        {!error && products === null && <p className="mt-6 text-text-medium">Loading…</p>}
        {visibleProducts?.length === 0 && (
          <div className="mt-8">
            <EmptyState
              label={activeCategory === ALL ? "Nothing published yet." : "Nothing in this category yet."}
            />
          </div>
        )}

        <div className="mt-8 grid grid-cols-1 gap-6 sm:grid-cols-2 md:grid-cols-3">
          {visibleProducts?.map((p) => (
            <Card key={p.id} className="overflow-hidden">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.imageUrl} alt={p.name} className="h-40 w-full object-cover" />
              <div className="p-4">
                <h2 className="font-semibold text-text-dark">{p.name}</h2>
                <span className="mt-1 inline-block rounded-[var(--radius-sm)] bg-gold/15 px-2 py-0.5 text-xs font-medium text-gold-dark">
                  {p.unit}
                </span>
                <p className="mt-2 font-bold tabular-nums text-primary">{formatNaira(p.priceKobo)}</p>
              </div>
            </Card>
          ))}
        </div>
      </div>
    </main>
  );
}
