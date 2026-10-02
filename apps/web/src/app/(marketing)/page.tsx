import Image from "next/image";
import type { Metadata } from "next";
import Link from "next/link";
import { HomeStorefront } from "../../components/site/HomeStorefront";

import { FaqAccordion } from "../../components/site/FaqAccordion";
import { RepaymentCalculator } from "../../components/site/RepaymentCalculator";
import {
  BriefcaseIcon,
  CalendarIcon,
  CartIcon,
  CheckIcon,
  PercentIcon,
  ShieldIcon,

  WalletIcon,
} from "../../components/ui/icons";

export const metadata: Metadata = {
  title: "Farmer Market — Everyday Groceries & Grocery Credit",
  description: "Shop groceries and household bundles. Explore payment plans and apply for grocery credit, subject to approval.",
};

interface BnplPlan {
  id: string;
  name: string;
  durationMonths: number;
  interestPercent: number;
  isPopular: boolean;
}

const HOW_IT_WORKS = [
  {
    icon: BriefcaseIcon,
    title: "Apply",
    body: "Tell us who you are, where you work, and how much credit you'd like — takes a few minutes.",
  },
  {
    icon: CheckIcon,
    title: "Get approved",
    body: "A credit officer reviews your application. Once approved, view your available limit in your account.",
  },
  {
    icon: CartIcon,
    title: "Shop, pay later",
    body: "Buy groceries today with your credit limit, and pay it back on a plan that fits your payday.",
  },
];

const FAQS = [
  {
    question: "How much credit can I get?",
    answer:
      "It depends on your income and employment — you tell us how much you'd like when you apply, a credit officer reviews it, and your approved limit may be the full amount or an adjusted one that fits your circumstances.",
  },
  {
    question: "Is there interest?",
    answer:
      "Pay Now and Pay Next Salary are 0% fee. The 2-month and 3-month plans carry a small, fixed fee — shown upfront on every plan before you choose, never added afterward.",
  },
  {
    question: "What happens after I apply?",
    answer:
      "A credit officer reviews your identity, employment, and documents. Once approved, you can view your credit limit in your account and use it to shop.",
  },
  {
    question: "What can I buy with my credit limit?",
    answer:
      "Everyday grocery staples — rice, cooking oil, and more being added regularly. Browse what's currently available on the marketplace, no application needed to look.",
  },
  {
    question: "What if my application isn't approved?",
    answer:
      "Not every application is approved on the first try. You can reapply, and there's no fee or penalty for applying — it's a straightforward credit review, not a loan you owe anything on until you actually spend it.",
  },
];

// Real data (§11.2's "Plan comparison"), not a hardcoded copy — reads the
// same table the phone app's BnplPlan.allPlans is meant to be replaced by
// (§14). Fetched server-side since this section needs no interactivity.
async function getPlans(): Promise<BnplPlan[]> {
  try {
    const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/v1/catalog/bnpl-plans`, {
      next: { revalidate: 60 },
    });
    if (!res.ok) return [];
    return res.json();
  } catch {
    // API unreachable (e.g. at build time with no server up) — the section
    // just doesn't render rather than failing the whole page.
    return [];
  }
}

// Cycled by index rather than matched to a specific plan id — the plan
// list is server-driven (§5.7) and its order/count can change from the
// dashboard, so this just needs to look intentional, not be authoritative.
const PLAN_ICONS = [PercentIcon, CalendarIcon, WalletIcon, ShieldIcon];

export default async function MarketingHome() {
  const plans = await getPlans();

  return (
    <main className="flex min-h-screen flex-col bg-[#f4f5f6]">
      <HomeStorefront />

      {/* How it works */}
      <section id="how-it-works" aria-labelledby="credit-title" className="scroll-mt-40 w-full px-4 py-8 sm:px-6">
        <div className="mx-auto grid max-w-6xl items-center gap-8 overflow-hidden rounded-2xl border border-primary/10 bg-white p-6 sm:p-8 lg:grid-cols-[1.3fr_0.8fr] lg:gap-12">
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-primary">Grocery credit</p>
            <h2 id="credit-title" className="mt-3 max-w-lg text-3xl font-bold leading-tight tracking-tight text-text-dark sm:text-4xl">
              Groceries today.<br />Repay around payday.
            </h2>
            <p className="mt-4 max-w-lg text-sm leading-relaxed text-text-medium">
              Give your household a little more room before payday. Apply for grocery credit and choose a repayment plan that fits your budget.
            </p>
            <ol className="mt-6 space-y-4">
              {HOW_IT_WORKS.map(({ title, body }, i) => (
                <li key={title} className="flex gap-3">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary-surface text-sm font-bold text-primary">{i + 1}</span>
                  <div><h3 className="text-sm font-semibold text-text-dark">{title}</h3><p className="mt-1 max-w-md text-sm leading-relaxed text-text-medium">{body}</p></div>
                </li>
              ))}
            </ol>
            <div className="mt-6 flex flex-wrap items-center gap-4">
              <Link href="/apply" className="inline-flex min-h-11 items-center justify-center rounded-md bg-gold px-5 py-3 text-sm font-semibold text-text-dark transition-colors hover:bg-gold-light focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">Apply for credit</Link>
              <a href="#plans" className="text-sm font-semibold text-primary hover:underline">Compare payment plans →</a>
            </div>
            <p className="mt-3 text-xs text-text-muted">Credit subject to approval.</p>
          </div>
          <div className="mx-auto w-full max-w-sm overflow-hidden rounded-xl bg-primary-surface">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="https://res.cloudinary.com/hr9pb13k/image/upload/v1787880745/Promo_image1.png"
              alt="Two smiling professionals representing public and private sector applicants"
              loading="lazy"
              className="aspect-square w-full object-contain"
            />
          </div>
        </div>
      </section>

      {/* Plan comparison — real data from /v1/catalog/bnpl-plans */}
      {plans.length > 0 ? (
        <section id="plans" className="scroll-mt-40 w-full bg-surface px-6 py-12">
          <div className="mx-auto max-w-5xl">
            <h2 className="text-center text-3xl font-bold tracking-tight text-text-dark sm:text-4xl">
              Pick a plan that fits your payday
            </h2>

            <div className="mt-10">
              <RepaymentCalculator plans={plans} />
            </div>

            <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
              {plans.map((plan, i) => {
                const Icon = PLAN_ICONS[i % PLAN_ICONS.length];
                return (
                  <div
                    key={plan.id}
                    className={`relative rounded-[var(--radius-lg)] bg-white p-6 transition-transform hover:-translate-y-1 ${
                      plan.isPopular
                        ? "border-2 border-gold shadow-[var(--shadow-card)]"
                        : "border border-dark-border/60"
                    }`}
                  >
                    {plan.isPopular && (
                      <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-gold px-3 py-0.5 text-xs font-bold text-white">
                        Popular
                      </span>
                    )}
                    <div className="flex h-10 w-10 items-center justify-center rounded-[var(--radius-sm)] bg-primary-surface text-primary">
                      <Icon className="h-5 w-5" />
                    </div>
                    <p className="mt-4 font-semibold text-text-dark">{plan.name}</p>
                    <p className="mt-1 text-2xl font-bold tabular-nums text-primary">
                      {plan.interestPercent === 0 ? "Free" : `${plan.interestPercent}% fee`}
                    </p>
                    <p className="mt-1 text-sm text-text-muted">
                      {plan.durationMonths === 0
                        ? "Paid immediately"
                        : plan.durationMonths === 1
                          ? "Deducted next salary"
                          : `Over ${plan.durationMonths} months`}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      ) : <section id="plans" className="scroll-mt-40 px-6 py-12 text-center"><h2 className="text-2xl font-bold">Payment plans</h2><p className="mt-3 text-text-medium">Payment plans are temporarily unavailable. Please check back before choosing your repayment option.</p></section>}

      {/* FAQ */}
      <section id="help" className="w-full scroll-mt-40 px-6 py-12">
        <div className="mx-auto max-w-2xl">
          <h2 className="text-center text-3xl font-bold tracking-tight text-text-dark sm:text-4xl">
            Frequently asked questions
          </h2>
          <div className="mt-10">
            <FaqAccordion items={FAQS} />
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="relative w-full overflow-hidden px-6 py-20 text-center" style={{ background: "var(--gradient-dark-card)" }}>
        <div
          className="pointer-events-none absolute -bottom-24 left-1/2 h-72 w-[36rem] -translate-x-1/2 rounded-full blur-3xl"
          style={{ background: "radial-gradient(circle, rgba(245,166,35,0.18), transparent 70%)" }}
        />
        <div className="relative mx-auto max-w-xl">
          <h2 className="text-3xl font-bold text-white sm:text-4xl">Ready to shop, pay later?</h2>
          <p className="mx-auto mt-3 max-w-sm text-white/70">
            Apply for your credit limit in a few minutes. A real credit officer reviews every
            application.
          </p>
          <Link
            href="/apply"
            className="mt-8 inline-flex rounded-[var(--radius-sm)] bg-primary px-8 py-3.5 text-base font-semibold text-white transition-colors hover:bg-primary-light"
          >
            Apply for a credit limit
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="w-full border-t border-dark-border/10 px-6 py-10">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 sm:flex-row">
          <div className="flex items-center gap-2">
            <Image src="/icon.png" alt="" width={24} height={24} className="rounded-[var(--radius-sm)]" />
            <span className="text-sm font-semibold text-text-dark">Farmer Market</span>
          </div>
          <p className="text-xs text-text-muted">© {new Date().getFullYear()} Farmer Market. All rights reserved.</p>
        </div>
      </footer>
    </main>
  );
}
