import Image from "next/image";
import Link from "next/link";

interface BnplPlan {
  id: string;
  name: string;
  durationMonths: number;
  interestPercent: number;
  isPopular: boolean;
}

const HOW_IT_WORKS = [
  {
    step: "1",
    title: "Apply",
    body: "Tell us who you are, where you work, and how much credit you'd like — takes a few minutes.",
  },
  {
    step: "2",
    title: "Get approved",
    body: "A credit officer reviews your application. Once approved, your limit is live on the app.",
  },
  {
    step: "3",
    title: "Shop, pay later",
    body: "Buy groceries today with your credit limit, and pay it back on a plan that fits your payday.",
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

export default async function MarketingHome() {
  const plans = await getPlans();

  return (
    <main className="flex min-h-screen flex-col items-center bg-white">
      {/* Hero */}
      <div className="flex w-full flex-col items-center gap-6 px-6 py-24 text-center">
        <Image src="/logo.png" alt="Farmer Market" width={220} height={98} priority />
        <h1 className="max-w-3xl text-4xl font-extrabold tracking-tight text-text-dark sm:text-5xl">
          Buy food now, <span className="text-gold-dark">pay later</span>
        </h1>
        <p className="max-w-xl text-lg text-text-medium">
          Apply for a credit limit in minutes, spend it on groceries today, and pay it back on
          payday.
        </p>
        <div className="flex flex-wrap justify-center gap-3">
          <Link
            href="/apply"
            className="rounded-[var(--radius-sm)] bg-primary px-6 py-3 text-base font-semibold text-white transition-colors hover:bg-primary-dark"
          >
            Apply for a credit limit
          </Link>
          <Link
            href="/marketplace"
            className="rounded-[var(--radius-sm)] border-2 border-gold px-6 py-3 text-base font-semibold text-gold-dark transition-colors hover:bg-gold/10"
          >
            See what you can buy
          </Link>
        </div>
      </div>

      {/* How it works */}
      <section className="w-full bg-surface px-6 py-20">
        <div className="mx-auto max-w-5xl">
          <h2 className="text-center text-2xl font-bold tracking-tight text-text-dark sm:text-3xl">
            How it works
          </h2>
          <div className="mt-12 grid gap-8 sm:grid-cols-3">
            {HOW_IT_WORKS.map((item) => (
              <div key={item.step} className="text-center">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full border-2 border-gold text-lg font-bold text-gold-dark">
                  {item.step}
                </div>
                <h3 className="mt-4 font-semibold text-text-dark">{item.title}</h3>
                <p className="mt-2 text-sm text-text-medium">{item.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Plan comparison — real data from /v1/catalog/bnpl-plans */}
      {plans.length > 0 && (
        <section className="w-full px-6 py-20">
          <div className="mx-auto max-w-5xl">
            <h2 className="text-center text-2xl font-bold tracking-tight text-text-dark sm:text-3xl">
              Pick a plan that fits your payday
            </h2>
            <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
              {plans.map((plan) => (
                <div
                  key={plan.id}
                  className={`relative rounded-[var(--radius-lg)] border p-6 ${
                    plan.isPopular ? "border-gold shadow-[var(--shadow-card)]" : "border-dark-border/60"
                  }`}
                >
                  {plan.isPopular && (
                    <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-gold px-3 py-0.5 text-xs font-bold text-white">
                      Popular
                    </span>
                  )}
                  <p className="font-semibold text-text-dark">{plan.name}</p>
                  <p className="mt-2 text-2xl font-bold tabular-nums text-primary">
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
              ))}
            </div>
          </div>
        </section>
      )}
    </main>
  );
}
