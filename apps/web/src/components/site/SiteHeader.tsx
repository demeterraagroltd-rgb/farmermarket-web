import Image from "next/image";
import Link from "next/link";

// Shared across the public pages (marketing, apply, marketplace) — none of
// them sit under one route group, so this is a plain imported component
// rather than a nested layout.tsx.
export function SiteHeader() {
  return (
    <header className="sticky top-0 z-30 w-full border-b border-dark-border/10 bg-white/85 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3.5">
        <Link href="/" className="flex items-center gap-2">
          <Image src="/icon.png" alt="" width={30} height={30} className="rounded-[var(--radius-sm)]" />
          <span className="font-bold text-text-dark">Farmer Market</span>
        </Link>
        <nav className="hidden items-center gap-7 text-sm font-medium text-text-medium sm:flex">
          <Link href="/#how-it-works" className="transition-colors hover:text-text-dark">
            How it works
          </Link>
          <Link href="/#plans" className="transition-colors hover:text-text-dark">
            Plans
          </Link>
          <Link href="/marketplace" className="transition-colors hover:text-text-dark">
            Marketplace
          </Link>
        </nav>
        <Link
          href="/apply"
          className="rounded-[var(--radius-sm)] bg-primary px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary-dark"
        >
          Apply now
        </Link>
      </div>
    </header>
  );
}
