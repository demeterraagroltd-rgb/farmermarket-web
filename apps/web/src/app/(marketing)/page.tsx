import Image from "next/image";
import Link from "next/link";
import { SiteHeader } from "../../components/site/SiteHeader";
import { FaqAccordion } from "../../components/site/FaqAccordion";
import {
  BriefcaseIcon,
  CalendarIcon,
  CartIcon,
  CheckIcon,
  LeafIcon,
  PercentIcon,
  ShieldIcon,
  SparkleIcon,
  WalletIcon,
} from "../../components/ui/icons";

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
    body: "A credit officer reviews your application. Once approved, your limit is live on the app.",
  },
  {
    icon: CartIcon,
    title: "Shop, pay later",
    body: "Buy groceries today with your credit limit, and pay it back on a plan that fits your payday.",
  },
];

const TRUST_POINTS = [
  { icon: PercentIcon, label: "0% fee on Pay Now & Pay Next Salary" },
  { icon: ShieldIcon, label: "Every application reviewed by a credit officer" },
  { icon: LeafIcon, label: "Real staples — rice, oil, and more" },
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
      "A credit officer reviews your application — identity, employment, and the documents you provide. Once approved, your credit limit is unlocked on the Farmer Market app and you can start shopping immediately.",
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
    <main className="flex min-h-screen flex-col bg-white">
      <SiteHeader />

      {/* Hero — asymmetric, with a decorative brand card rather than a
          centered logo. The blurred color fields are low-opacity brand
          tokens, not stock-photo abstraction. */}
      <section className="relative overflow-hidden">
        <div
          className="pointer-events-none absolute -left-24 -top-24 h-96 w-96 rounded-full blur-3xl"
          style={{ background: "radial-gradient(circle, rgba(26,122,76,0.16), transparent 70%)" }}
        />
        <div
          className="pointer-events-none absolute -right-32 top-20 h-96 w-96 rounded-full blur-3xl"
          style={{ background: "radial-gradient(circle, rgba(245,166,35,0.18), transparent 70%)" }}
        />

        <div className="relative mx-auto grid max-w-6xl gap-12 px-6 py-20 lg:grid-cols-[1.1fr_0.9fr] lg:items-center lg:py-28">
          <div>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-gold/15 px-3 py-1 text-xs font-bold uppercase tracking-wide text-gold-dark">
              <SparkleIcon className="h-3.5 w-3.5" />
              Buy Now, Pay Later — for groceries
            </span>
            <h1 className="mt-5 max-w-xl text-5xl font-extrabold leading-[1.05] tracking-tight text-text-dark sm:text-6xl">
              Buy food now,
              <br />
              <span className="text-primary">pay later.</span>
            </h1>
            <p className="mt-6 max-w-md text-lg text-text-medium">
              Apply for a credit limit in minutes, spend it on groceries today, and pay it back on
              a plan that fits your payday.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                href="/apply"
                className="rounded-[var(--radius-sm)] bg-primary px-6 py-3.5 text-base font-semibold text-white shadow-[var(--shadow-card)] transition-colors hover:bg-primary-dark"
              >
                Apply for a credit limit
              </Link>
              <Link
                href="/marketplace"
                className="rounded-[var(--radius-sm)] border-2 border-gold px-6 py-3.5 text-base font-semibold text-gold-dark transition-colors hover:bg-gold/10"
              >
                See what you can buy
              </Link>
            </div>
            <div className="mt-10 flex flex-wrap gap-x-6 gap-y-3">
              {TRUST_POINTS.map(({ icon: Icon, label }) => (
                <div key={label} className="flex items-center gap-2 text-sm text-text-medium">
                  <Icon className="h-4 w-4 shrink-0 text-primary" />
                  {label}
                </div>
              ))}
            </div>
          </div>

          {/* Layered visual: a product photo card behind a floating brand
              card, both slightly rotated — the "fancy, not generic" bit. */}
          <div className="relative mx-auto h-80 w-full max-w-sm lg:h-96">
            <div className="absolute inset-x-6 top-0 h-full -rotate-3 overflow-hidden rounded-[var(--radius-xl)] shadow-[var(--shadow-card)]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/products/big-bull-rice-50kg.jpg"
                alt="Bag of rice"
                className="h-full w-full object-cover"
              />
            </div>
            <div
              className="absolute bottom-0 left-0 w-64 rotate-3 rounded-[var(--radius-lg)] p-5 text-white shadow-[var(--shadow-card)]"
              style={{ background: "var(--gradient-credit-card)" }}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium uppercase tracking-wide text-white/70">
                  Farmer Market
                </span>
                <WalletIcon className="h-5 w-5 text-white/80" />
              </div>
              <p className="mt-4 text-lg font-bold">Food Credit</p>
              <p className="mt-1 text-sm text-white/70">Pay Next Salary · 0% fee</p>
            </div>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section id="how-it-works" className="w-full bg-surface px-6 py-24">
        <div className="mx-auto max-w-5xl">
          <p className="text-center text-sm font-bold uppercase tracking-wide text-primary">The loop</p>
          <h2 className="mt-2 text-center text-3xl font-bold tracking-tight text-text-dark sm:text-4xl">
            How it works
          </h2>
          <div className="relative mt-16 grid gap-10 sm:grid-cols-3">
            <div className="absolute left-0 right-0 top-8 hidden h-0.5 bg-dark-border/40 sm:block" />
            {HOW_IT_WORKS.map(({ icon: Icon, title, body }, i) => (
              <div key={title} className="relative flex flex-col items-center text-center">
                <div className="relative z-10 flex h-16 w-16 items-center justify-center rounded-full bg-white text-primary shadow-[var(--shadow-card)]">
                  <Icon className="h-7 w-7" />
                </div>
                <span className="mt-3 text-xs font-bold uppercase tracking-wide text-gold-dark">
                  Step {i + 1}
                </span>
                <h3 className="mt-1 text-lg font-semibold text-text-dark">{title}</h3>
                <p className="mt-2 max-w-[240px] text-sm text-text-medium">{body}</p>
              </div>
            ))}
          </div>

          <div className="mt-16 overflow-hidden rounded-[var(--radius-xl)] shadow-[var(--shadow-card)]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="https://res.cloudinary.com/hr9pb13k/image/upload/v1787880745/Promo_image1.png"
              alt="Farmer Market — buy food now, pay later"
              className="h-auto w-full object-cover"
            />
          </div>
        </div>
      </section>

      {/* Shop by category — real product photography, links out. */}
      <section className="w-full px-6 py-24">
        <div className="mx-auto max-w-5xl">
          <h2 className="text-center text-3xl font-bold tracking-tight text-text-dark sm:text-4xl">
            What you can buy
          </h2>
          <p className="mx-auto mt-3 max-w-md text-center text-text-medium">
            Real staples, published straight from the Farmer Market dashboard.
          </p>
          <div className="mt-12 grid grid-cols-2 gap-4 sm:grid-cols-4">
            {[
              { src: "/products/big-bull-rice-50kg.jpg", label: "Rice" },
              { src: "/products/kings-oil-10l.jpg", label: "Cooking oil" },
              { src: "/products/mamador-vegetable-oil-500ml.webp", label: "Vegetable oil" },
              { src: "/products/power-oil-5lts.jpg", label: "Cooking oil" },
            ].map((p) => (
              <Link
                key={p.src}
                href="/marketplace"
                className="group overflow-hidden rounded-[var(--radius-lg)] border border-dark-border/60 transition-shadow hover:shadow-[var(--shadow-card)]"
              >
                <div className="aspect-square overflow-hidden bg-surface">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={p.src}
                    alt={p.label}
                    className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                  />
                </div>
                <p className="px-3 py-2.5 text-sm font-medium text-text-dark">{p.label}</p>
              </Link>
            ))}
          </div>
          <div className="mt-8 text-center">
            <Link href="/marketplace" className="text-sm font-semibold text-primary hover:underline">
              See the full marketplace →
            </Link>
          </div>
        </div>
      </section>

      {/* Plan comparison — real data from /v1/catalog/bnpl-plans */}
      {plans.length > 0 && (
        <section id="plans" className="w-full bg-surface px-6 py-24">
          <div className="mx-auto max-w-5xl">
            <h2 className="text-center text-3xl font-bold tracking-tight text-text-dark sm:text-4xl">
              Pick a plan that fits your payday
            </h2>
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
      )}

      {/* FAQ */}
      <section className="w-full px-6 py-24">
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
