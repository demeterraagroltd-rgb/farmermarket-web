"use client";

import { useEffect, useState } from "react";
import { Card, EmptyState } from "../../components/ui/Card";
import { formatNaira } from "../../lib/format";

interface Product {
  id: string;
  name: string;
  description: string;
  imageUrl: string;
  priceKobo: string;
  unit: string;
}

// Public — no auth. The "live product grid" from §11.2's landing page,
// pulled out as its own page for now. Reads GET /v1/catalog/products,
// which only ever returns published + available products.
export default function MarketplacePage() {
  const [products, setProducts] = useState<Product[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${process.env.NEXT_PUBLIC_API_URL}/v1/catalog/products`)
      .then(async (res) => {
        const body = await res.json();
        if (!res.ok) throw new Error(body.message ?? "Failed to load products");
        setProducts(body);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load products"));
  }, []);

  return (
    <main className="mx-auto max-w-5xl px-6 py-16">
      <h1 className="text-3xl font-bold tracking-tight text-text-dark">What you can buy</h1>
      <p className="mt-2 text-text-medium">Every product available with a Farmer Market credit limit.</p>

      {error && <p className="mt-6 text-sm text-error">{error}</p>}
      {!error && products === null && <p className="mt-6 text-text-medium">Loading…</p>}
      {products?.length === 0 && (
        <div className="mt-8">
          <EmptyState label="Nothing published yet." />
        </div>
      )}

      <div className="mt-8 grid grid-cols-1 gap-6 sm:grid-cols-2 md:grid-cols-3">
        {products?.map((p) => (
          <Card key={p.id} className="overflow-hidden">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={p.imageUrl} alt={p.name} className="h-40 w-full object-cover" />
            <div className="p-4">
              <h2 className="font-semibold text-text-dark">{p.name}</h2>
              <p className="text-sm text-text-muted">{p.unit}</p>
              <p className="mt-2 font-bold tabular-nums text-primary">{formatNaira(p.priceKobo)}</p>
            </div>
          </Card>
        ))}
      </div>
    </main>
  );
}
