"use client";

import { useMemo, useState } from "react";

interface Plan {
  id: string;
  name: string;
  durationMonths: number;
  interestPercent: number;
  isPopular: boolean;
}

const NGN = new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", maximumFractionDigits: 0 });
const PRESETS = [10000, 25000, 50000, 100000];

// Client island on the (server-rendered) marketing page. Same fee maths as
// checkout: total = amount + amount·interest%, split evenly across the plan's
// months (Pay Now / Pay Next Salary = one payment).
export function RepaymentCalculator({ plans }: { plans: Plan[] }) {
  const usable = plans.length ? plans : FALLBACK_PLANS;
  const [amount, setAmount] = useState(25000);
  const [planId, setPlanId] = useState(usable.find((p) => p.isPopular)?.id ?? usable[0].id);

  const plan = usable.find((p) => p.id === planId) ?? usable[0];
  const { total, perPayment, payments, fee } = useMemo(() => {
    const fee = Math.round(amount * (plan.interestPercent / 100));
    const total = amount + fee;
    const payments = plan.durationMonths === 0 ? 1 : plan.durationMonths;
    return { total, fee, payments, perPayment: Math.round(total / payments) };
  }, [amount, plan]);

  return (
    <div className="mx-auto max-w-xl rounded-[var(--radius-lg)] border border-dark-border/60 bg-white p-6 shadow-[var(--shadow-card)]">
      <p className="text-sm font-semibold uppercase tracking-wide text-text-muted">
        What would it cost me?
      </p>

      <label className="mt-4 block text-sm font-medium text-text-dark">
        Purchase amount
        <input
          type="range"
          min={5000}
          max={200000}
          step={1000}
          value={amount}
          onChange={(e) => setAmount(Number(e.target.value))}
          className="mt-2 w-full accent-primary"
          aria-label="Purchase amount"
        />
      </label>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <span className="text-2xl font-bold tabular-nums text-primary">{NGN.format(amount)}</span>
        <div className="flex gap-1.5">
          {PRESETS.map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setAmount(v)}
              className={`rounded-full px-2.5 py-1 text-xs font-semibold transition-colors ${
                amount === v ? "bg-primary text-white" : "border border-dark-border/60 text-text-medium hover:bg-surface"
              }`}
            >
              {NGN.format(v)}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-5 flex flex-wrap gap-2">
        {usable.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => setPlanId(p.id)}
            className={`rounded-[var(--radius-sm)] border px-3 py-2 text-left text-sm transition-colors ${
              p.id === plan.id ? "border-primary bg-primary-surface" : "border-dark-border/60 hover:bg-surface"
            }`}
          >
            <span className="font-semibold text-text-dark">{p.name}</span>
            <span className="ml-1.5 text-xs text-text-muted">
              {p.interestPercent === 0 ? "0% fee" : `${p.interestPercent}% fee`}
            </span>
          </button>
        ))}
      </div>

      <div className="mt-6 grid grid-cols-2 gap-3 rounded-[var(--radius-sm)] bg-surface p-4 text-sm">
        <span className="text-text-muted">You spend</span>
        <span className="text-right font-semibold tabular-nums text-text-dark">{NGN.format(amount)}</span>
        <span className="text-text-muted">Plan fee</span>
        <span className="text-right font-semibold tabular-nums text-text-dark">
          {fee === 0 ? "Free" : NGN.format(fee)}
        </span>
        <span className="text-text-muted">You repay</span>
        <span className="text-right font-semibold tabular-nums text-text-dark">{NGN.format(total)}</span>
        <span className="border-t border-dark-border/40 pt-2 font-semibold text-text-dark">
          {payments === 1 ? "One payment" : `${payments} payments of`}
        </span>
        <span className="border-t border-dark-border/40 pt-2 text-right text-lg font-bold tabular-nums text-primary">
          {NGN.format(perPayment)}
        </span>
      </div>

      <p className="mt-3 text-xs text-text-muted">
        Estimate only. Your actual limit and terms are set when a credit officer reviews your application.
      </p>
    </div>
  );
}

const FALLBACK_PLANS: Plan[] = [
  { id: "pay-now", name: "Pay Now", durationMonths: 0, interestPercent: 0, isPopular: false },
  { id: "next-salary", name: "Pay Next Salary", durationMonths: 1, interestPercent: 0, isPopular: true },
  { id: "two-months", name: "Pay Over 2 Months", durationMonths: 2, interestPercent: 2, isPopular: false },
  { id: "three-months", name: "Pay Over 3 Months", durationMonths: 3, interestPercent: 4, isPopular: false },
];
