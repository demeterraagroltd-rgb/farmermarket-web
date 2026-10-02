"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { Product } from "../../lib/catalog";

export function FeaturedProducts() {
  const [products, setProducts] = useState<Product[]>([]);
  useEffect(() => {
    const controller = new AbortController();
    fetch(`${process.env.NEXT_PUBLIC_API_URL}/v1/catalog/products`, { signal: controller.signal })
      .then(async (res) => { if (res.ok) setProducts((await res.json() as Product[]).filter((p) => p.tags?.includes("homepage-featured"))); })
      .catch(() => {});
    return () => controller.abort();
  }, []);
  return <div className="mt-8 grid grid-cols-2 gap-4 md:grid-cols-4">{products.map((product) => <Link key={product.id} href={`/marketplace/${product.id}`} className="overflow-hidden rounded-2xl border border-dark-border/40 bg-white transition-shadow hover:shadow-md">
    {/* eslint-disable-next-line @next/next/no-img-element */}
    <img src={product.imageUrl} alt={product.name} className="h-48 w-full object-contain p-3" loading="lazy" />
    <p className="px-3 pb-3 text-sm font-medium text-text-dark">{product.name}</p>
  </Link>)}</div>;
}
