import Image from "next/image";
import Link from "next/link";

// Placeholder for the real landing page in §11.2 (hero, live credit
// calculator, plan comparison, live product grid). This just proves the
// route group and design tokens wire up end to end.
export default function MarketingHome() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col items-center justify-center gap-6 px-6 text-center">
      <Image src="/logo.png" alt="Farmer Market" width={220} height={98} priority />
      <h1 className="text-4xl font-extrabold tracking-tight text-text-dark sm:text-5xl">
        Buy food now, pay later
      </h1>
      <p className="max-w-xl text-lg text-text-medium">
        Apply for a credit limit in minutes, spend it on groceries today, and pay it back on
        payday.
      </p>
      <div className="flex gap-3">
        <Link
          href="/apply"
          className="rounded-[var(--radius-sm)] bg-primary px-6 py-3 text-base font-semibold text-white transition-colors hover:bg-primary-dark"
        >
          Apply for a credit limit
        </Link>
        <Link
          href="/marketplace"
          className="rounded-[var(--radius-sm)] bg-primary-surface px-6 py-3 text-base font-semibold text-primary-dark transition-colors hover:bg-primary-surface/70"
        >
          See what you can buy
        </Link>
      </div>
    </main>
  );
}
