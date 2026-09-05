"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { SiteHeader } from "../../components/site/SiteHeader";
import { Card } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { Input } from "../../components/ui/Field";
import { formatNairaAmount } from "../../lib/format";
import { clearCart, getCart, totalsOf, type CartLine } from "../../lib/cart";
import {
  accountFetch,
  getCustomerSession,
  patchCustomerSession,
  readError,
  type CustomerSession,
} from "../../lib/customer";

interface BnplPlan {
  id: string;
  name: string;
  durationMonths: number;
  interestPercent: number;
  isPopular: boolean;
  isActive: boolean;
}

function planMath(plan: BnplPlan, total: number) {
  const installments = plan.durationMonths === 0 ? 1 : plan.durationMonths;
  const totalWithFee = total + total * (plan.interestPercent / 100);
  return { installments, totalWithFee, installmentAmount: totalWithFee / installments };
}

// Mirrors the phone app's checkout: pick a BNPL plan (GET /v1/catalog/bnpl-
// plans), enter a delivery address, authorize with the 4-digit transaction
// code (creating one first if this is the account's first order — see
// lib/features/auth/presentation/widgets/transaction_pin_sheet.dart for the
// pattern this follows), then POST /v1/orders. The server re-prices and
// re-checks verification independently of anything shown here.
export default function CheckoutPage() {
  const router = useRouter();
  const [session, setSession] = useState<CustomerSession | null | undefined>(undefined);
  const [lines, setLines] = useState<CartLine[]>([]);
  const [plans, setPlans] = useState<BnplPlan[] | null>(null);
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  const [address, setAddress] = useState("");
  const [pin, setPin] = useState("");
  const [pinConfirm, setPinConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [placing, setPlacing] = useState(false);

  useEffect(() => {
    const current = getCustomerSession();
    setSession(current);
    if (!current) {
      router.replace("/account/login?next=/checkout");
      return;
    }
    if (current.verificationStatus !== "verified") {
      router.replace("/cart");
      return;
    }

    const cartLines = getCart();
    if (cartLines.length === 0) {
      router.replace("/cart");
      return;
    }
    setLines(cartLines);

    const base = process.env.NEXT_PUBLIC_API_URL;
    fetch(`${base}/v1/catalog/bnpl-plans`)
      .then((res) => (res.ok ? res.json() : []))
      .then((rows: BnplPlan[]) => {
        setPlans(rows);
        const popular = rows.find((p) => p.isPopular) ?? rows[0];
        if (popular) setSelectedPlanId(popular.id);
      })
      .catch(() => setPlans([]));
  }, [router]);

  if (!session || lines.length === 0) {
    return (
      <>
        <SiteHeader />
        <main className="min-h-screen bg-white px-6 py-16">
          <p className="mx-auto max-w-2xl text-text-medium">Loading checkout…</p>
        </main>
      </>
    );
  }

  const totals = totalsOf(lines);
  const selectedPlan = plans?.find((p) => p.id === selectedPlanId) ?? null;
  const math = selectedPlan ? planMath(selectedPlan, totals.total) : null;
  const needsNewPin = !session.hasTxnPin;

  async function handlePlaceOrder() {
    setError(null);

    if (!address.trim()) {
      setError("Enter a delivery address.");
      return;
    }
    if (!selectedPlan) {
      setError("Choose a repayment plan.");
      return;
    }
    if (!/^\d{4}$/.test(pin)) {
      setError("Your transaction code must be 4 digits.");
      return;
    }
    if (needsNewPin && pin !== pinConfirm) {
      setError("The transaction codes don't match.");
      return;
    }

    setPlacing(true);
    try {
      if (needsNewPin) {
        const pinRes = await accountFetch("/v1/auth/customer/txn-pin", {
          method: "POST",
          body: JSON.stringify({ pin }),
        });
        if (!pinRes.ok) throw new Error(await readError(pinRes));
        patchCustomerSession({ hasTxnPin: true });
      }

      const orderRes = await accountFetch("/v1/orders", {
        method: "POST",
        body: JSON.stringify({
          items: lines.map((l) => ({ productId: l.product.id, quantity: l.quantity })),
          deliveryAddress: address.trim(),
          bnplPlanId: selectedPlan.id,
          txnPin: pin,
        }),
      });
      if (!orderRes.ok) throw new Error(await readError(orderRes));
      const order = await orderRes.json();

      clearCart();
      router.push(`/checkout/confirmation?orderId=${order.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't place your order.");
    } finally {
      setPlacing(false);
    }
  }

  return (
    <>
      <SiteHeader />
      <main className="min-h-screen bg-white px-6 py-12">
        <div className="mx-auto max-w-2xl">
          <h1 className="text-2xl font-bold tracking-tight text-text-dark">Checkout</h1>

          <Card className="mt-6 p-5">
            <p className="text-sm font-semibold text-text-dark">
              {lines.reduce((n, l) => n + l.quantity, 0)} item
              {lines.reduce((n, l) => n + l.quantity, 0) === 1 ? "" : "s"}
            </p>
            <p className="mt-1 text-xs text-text-muted">
              {lines.map((l) => `${l.quantity}× ${l.product.name}`).join(", ")}
            </p>
          </Card>

          <div className="mt-5">
            <Input
              label="Delivery address"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="Street, city, state"
              required
            />
          </div>

          <div className="mt-6">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-muted">
              Repayment plan
            </p>
            {plans === null ? (
              <p className="text-sm text-text-muted">Loading plans…</p>
            ) : (
              <div className="flex flex-col gap-2">
                {plans.map((plan) => {
                  const m = planMath(plan, totals.total);
                  const active = plan.id === selectedPlanId;
                  return (
                    <button
                      key={plan.id}
                      type="button"
                      onClick={() => setSelectedPlanId(plan.id)}
                      className={`flex items-center justify-between rounded-[var(--radius-sm)] border-2 px-4 py-3 text-left transition-colors ${
                        active ? "border-primary bg-primary-surface" : "border-dark-border/60 hover:bg-surface"
                      }`}
                    >
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-text-dark">{plan.name}</span>
                          {plan.isPopular && (
                            <span className="rounded-full bg-gold/15 px-2 py-0.5 text-[10px] font-bold uppercase text-gold-dark">
                              Popular
                            </span>
                          )}
                        </div>
                        <p className="mt-0.5 text-xs text-text-muted">
                          {m.installments === 1
                            ? "Pay in full"
                            : `${m.installments} installments of ${formatNairaAmount(m.installmentAmount)}`}
                          {plan.interestPercent > 0 ? ` · ${plan.interestPercent}% fee` : " · no fee"}
                        </p>
                      </div>
                      <span className="font-bold tabular-nums text-primary">
                        {formatNairaAmount(m.totalWithFee)}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div className="mt-6">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-muted">
              {needsNewPin ? "Create a 4-digit transaction code" : "Enter your transaction code"}
            </p>
            {needsNewPin && (
              <p className="mb-3 text-sm text-text-medium">
                You&apos;ll use this to authorize orders and repayments — on the web and in the app.
              </p>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              <Input
                label={needsNewPin ? "New code" : "Transaction code"}
                inputMode="numeric"
                type="password"
                maxLength={4}
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
              />
              {needsNewPin && (
                <Input
                  label="Confirm code"
                  inputMode="numeric"
                  type="password"
                  maxLength={4}
                  value={pinConfirm}
                  onChange={(e) => setPinConfirm(e.target.value.replace(/\D/g, ""))}
                />
              )}
            </div>
          </div>

          <Card className="mt-6 p-5">
            <div className="flex flex-col gap-1.5 text-sm text-text-medium">
              <div className="flex justify-between">
                <span>Subtotal</span>
                <span className="tabular-nums">{formatNairaAmount(totals.subtotal)}</span>
              </div>
              <div className="flex justify-between">
                <span>Delivery fee</span>
                <span className="tabular-nums">{formatNairaAmount(totals.deliveryFee)}</span>
              </div>
              <div className="flex justify-between">
                <span>Service fee</span>
                <span className="tabular-nums">{formatNairaAmount(totals.serviceFee)}</span>
              </div>
              {math && math.totalWithFee > totals.total && (
                <div className="flex justify-between">
                  <span>Plan fee</span>
                  <span className="tabular-nums">{formatNairaAmount(math.totalWithFee - totals.total)}</span>
                </div>
              )}
            </div>
          </Card>

          {error && <p className="mt-4 whitespace-pre-line text-sm text-error">{error}</p>}

          <Button
            onClick={handlePlaceOrder}
            disabled={placing || !selectedPlan}
            className="mt-5 w-full"
          >
            {placing ? "Placing order…" : `Place order — ${formatNairaAmount(math?.totalWithFee ?? totals.total)}`}
          </Button>
          <p className="mt-3 text-center text-xs text-text-muted">
            Your order is reviewed before it&apos;s confirmed — nothing is charged until then.
          </p>
        </div>
      </main>
    </>
  );
}
