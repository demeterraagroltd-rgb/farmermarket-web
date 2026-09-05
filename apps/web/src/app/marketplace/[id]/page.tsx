"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { SiteHeader } from "../../../components/site/SiteHeader";
import { Card } from "../../../components/ui/Card";
import { Button } from "../../../components/ui/Button";
import { formatNairaAmount } from "../../../lib/format";
import { effectivePrice, fetchProduct, type Product } from "../../../lib/catalog";
import { addToCart } from "../../../lib/cart";

// Mirrors the phone app's FoodItemScreen — quantity stepper, running total,
// "Add to Cart" that actually leads somewhere afterwards (lib/features/
// marketplace/presentation/screens/food_item_screen.dart, and the cart-
// reachability fix on that side, commit 87e9dd3).
export default function ProductDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [product, setProduct] = useState<Product | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [added, setAdded] = useState(false);

  useEffect(() => {
    fetchProduct(id)
      .then(setProduct)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load this product."));
  }, [id]);

  function handleAddToCart() {
    if (!product) return;
    addToCart(
      {
        id: product.id,
        name: product.name,
        imageUrl: product.imageUrl,
        unit: product.unit,
        price: effectivePrice(product),
      },
      quantity,
    );
    setAdded(true);
  }

  if (error) {
    return (
      <>
        <SiteHeader />
        <main className="min-h-screen bg-white px-6 py-16">
          <p className="mx-auto max-w-2xl text-sm text-error">{error}</p>
        </main>
      </>
    );
  }

  if (product === undefined) {
    return (
      <>
        <SiteHeader />
        <main className="min-h-screen bg-white px-6 py-16">
          <p className="mx-auto max-w-2xl text-text-medium">Loading…</p>
        </main>
      </>
    );
  }

  if (product === null) {
    return (
      <>
        <SiteHeader />
        <main className="min-h-screen bg-white px-6 py-16">
          <div className="mx-auto max-w-2xl text-center">
            <p className="text-text-medium">This product isn&apos;t available anymore.</p>
            <Link href="/marketplace" className="mt-3 inline-block font-semibold text-primary hover:underline">
              Back to the marketplace
            </Link>
          </div>
        </main>
      </>
    );
  }

  const price = effectivePrice(product);

  return (
    <>
      <SiteHeader />
      <main className="min-h-screen bg-white px-6 py-12">
        <div className="mx-auto max-w-4xl">
          <Link href="/marketplace" className="text-sm font-semibold text-text-muted hover:text-text-dark">
            ← Marketplace
          </Link>

          <div className="mt-4 grid gap-8 md:grid-cols-2">
            <Card className="overflow-hidden">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={product.imageUrl} alt={product.name} className="aspect-square w-full object-cover" />
            </Card>

            <div>
              <span className="inline-block rounded-[var(--radius-sm)] bg-gold/15 px-2 py-0.5 text-xs font-medium text-gold-dark">
                {product.unit}
              </span>
              <h1 className="mt-2 text-2xl font-bold tracking-tight text-text-dark">{product.name}</h1>
              <p className="mt-1 text-sm text-text-muted">
                {product.brand} · {product.category}
              </p>

              <div className="mt-4 flex items-baseline gap-3">
                <p className="text-2xl font-bold tabular-nums text-primary">{formatNairaAmount(price)}</p>
                {product.discountPrice !== null && (
                  <p className="tabular-nums text-text-muted line-through">{formatNairaAmount(product.price)}</p>
                )}
              </div>

              {product.description && <p className="mt-4 text-sm text-text-medium">{product.description}</p>}

              {!product.isAvailable ? (
                <p className="mt-6 text-sm font-semibold text-error">Currently out of stock.</p>
              ) : (
                <>
                  <div className="mt-6 flex items-center gap-4">
                    <span className="text-sm font-semibold text-text-dark">Quantity</span>
                    <div className="flex items-center gap-3 rounded-[var(--radius-sm)] border border-dark-border/60 px-1">
                      <button
                        type="button"
                        onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                        className="flex h-8 w-8 items-center justify-center text-lg font-semibold text-text-medium hover:text-text-dark"
                        aria-label="Decrease quantity"
                      >
                        −
                      </button>
                      <span className="w-6 text-center font-semibold tabular-nums text-text-dark">{quantity}</span>
                      <button
                        type="button"
                        onClick={() => setQuantity((q) => q + 1)}
                        className="flex h-8 w-8 items-center justify-center text-lg font-semibold text-text-medium hover:text-text-dark"
                        aria-label="Increase quantity"
                      >
                        +
                      </button>
                    </div>
                  </div>

                  <div className="mt-6 flex flex-col gap-2.5 sm:flex-row">
                    <Button onClick={handleAddToCart} className="sm:flex-1">
                      Add to cart — {formatNairaAmount(price * quantity)}
                    </Button>
                    {added && (
                      <Button variant="secondary" onClick={() => router.push("/cart")}>
                        View cart
                      </Button>
                    )}
                  </div>
                  {added && <p className="mt-2 text-sm text-primary">Added to your cart.</p>}
                </>
              )}
            </div>
          </div>
        </div>
      </main>
    </>
  );
}
