"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { SiteHeader } from "../../components/site/SiteHeader";
import { Card, EmptyState } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { Badge } from "../../components/ui/Badge";
import { formatNairaAmount } from "../../lib/format";
import { getCart, setQuantity, totalsOf, type CartLine } from "../../lib/cart";
import { getCustomerSession, type CustomerSession } from "../../lib/customer";

export default function CartPage() {
  const router = useRouter();
  const [lines, setLines] = useState<CartLine[] | null>(null);
  const [session, setSession] = useState<CustomerSession | null>(null);

  useEffect(() => {
    setLines(getCart());
    setSession(getCustomerSession());
    const sync = () => setLines(getCart());
    window.addEventListener("farmermarket:cart", sync);
    return () => window.removeEventListener("farmermarket:cart", sync);
  }, []);

  if (lines === null) return null; // avoids a flash of "empty" before localStorage is read

  const totals = totalsOf(lines);
  const verified = session?.verificationStatus === "verified";

  return (
    <>
      <SiteHeader />
      <main className="min-h-screen bg-white px-6 py-12">
        <div className="mx-auto max-w-3xl">
          <h1 className="text-2xl font-bold tracking-tight text-text-dark">Your cart</h1>

          {lines.length === 0 ? (
            <div className="mt-8">
              <EmptyState label="Your cart is empty." />
              <div className="mt-4 text-center">
                <Link href="/marketplace" className="font-semibold text-primary hover:underline">
                  Browse the marketplace
                </Link>
              </div>
            </div>
          ) : (
            <>
              <Card className="mt-6 divide-y divide-dark-border/40 overflow-hidden">
                {lines.map((line) => (
                  <div key={line.product.id} className="flex items-center gap-4 p-4">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={line.product.imageUrl}
                      alt={line.product.name}
                      className="h-16 w-16 shrink-0 rounded-[var(--radius-sm)] object-cover"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold text-text-dark">{line.product.name}</p>
                      <p className="text-xs text-text-muted">
                        {line.product.unit} · {formatNairaAmount(line.product.price)} each
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2 rounded-[var(--radius-sm)] border border-dark-border/60 px-1">
                      <button
                        type="button"
                        onClick={() => setQuantity(line.product.id, line.quantity - 1)}
                        className="flex h-7 w-7 items-center justify-center text-text-medium hover:text-text-dark"
                        aria-label={`Decrease ${line.product.name} quantity`}
                      >
                        −
                      </button>
                      <span className="w-5 text-center text-sm font-semibold tabular-nums text-text-dark">
                        {line.quantity}
                      </span>
                      <button
                        type="button"
                        onClick={() => setQuantity(line.product.id, line.quantity + 1)}
                        className="flex h-7 w-7 items-center justify-center text-text-medium hover:text-text-dark"
                        aria-label={`Increase ${line.product.name} quantity`}
                      >
                        +
                      </button>
                    </div>
                    <p className="w-24 shrink-0 text-right font-semibold tabular-nums text-text-dark">
                      {formatNairaAmount(line.product.price * line.quantity)}
                    </p>
                    <button
                      type="button"
                      onClick={() => setQuantity(line.product.id, 0)}
                      className="shrink-0 text-xs font-semibold text-text-muted hover:text-error"
                      aria-label={`Remove ${line.product.name} from cart`}
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </Card>

              <Card className="mt-4 p-5">
                <div className="flex flex-col gap-2 text-sm">
                  <div className="flex justify-between text-text-medium">
                    <span>Subtotal</span>
                    <span className="tabular-nums">{formatNairaAmount(totals.subtotal)}</span>
                  </div>
                  <div className="flex justify-between text-text-medium">
                    <span>Delivery fee</span>
                    <span className="tabular-nums">{formatNairaAmount(totals.deliveryFee)}</span>
                  </div>
                  <div className="flex justify-between text-text-medium">
                    <span>Service fee (3%)</span>
                    <span className="tabular-nums">{formatNairaAmount(totals.serviceFee)}</span>
                  </div>
                  <div className="mt-1 flex justify-between border-t border-dark-border/40 pt-2 text-base font-bold text-text-dark">
                    <span>Total</span>
                    <span className="tabular-nums text-primary">{formatNairaAmount(totals.total)}</span>
                  </div>
                </div>

                {!session ? (
                  <div className="mt-5 flex flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <p className="text-sm text-text-medium">Sign in to check out with your credit limit.</p>
                    <Button onClick={() => router.push("/account/login?next=/cart")}>Sign in</Button>
                  </div>
                ) : !verified ? (
                  <div className="mt-5 flex flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-center gap-2">
                      <Badge tone="warning">Not verified</Badge>
                      <p className="text-sm text-text-medium">Finish your application to check out.</p>
                    </div>
                    <Button onClick={() => router.push("/apply")}>Continue application</Button>
                  </div>
                ) : (
                  <Button onClick={() => router.push("/checkout")} className="mt-5 w-full">
                    Proceed to checkout — {formatNairaAmount(totals.total)}
                  </Button>
                )}
              </Card>
            </>
          )}
        </div>
      </main>
    </>
  );
}
