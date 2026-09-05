"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { getCustomerSession } from "../../lib/customer";
import { CartLink } from "./CartLink";

// Shared across the public pages (marketing, apply, marketplace, account) —
// none of them sit under one route group, so this is a plain imported
// component rather than a nested layout.tsx.
//
// "use client" so it can read the customer session from localStorage and
// swap "Apply now" for "My account" once someone is signed in — otherwise
// a returning customer lands back on the public marketing nav with no way
// to reach the account they already have.
export function SiteHeader() {
  const [signedIn, setSignedIn] = useState(false);

  useEffect(() => {
    const sync = () => setSignedIn(getCustomerSession() !== null);
    sync();
    // `storage` fires in other tabs; `farmermarket:session` fires in this one
    // (saveCustomerSession/clearCustomerSession dispatch it manually).
    window.addEventListener("storage", sync);
    window.addEventListener("farmermarket:session", sync);
    return () => {
      window.removeEventListener("storage", sync);
      window.removeEventListener("farmermarket:session", sync);
    };
  }, []);

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
          {signedIn && (
            <Link href="/account" className="transition-colors hover:text-text-dark">
              My account
            </Link>
          )}
        </nav>
        <div className="flex items-center gap-2">
          <CartLink />
          {signedIn ? (
            <Link
              href="/account"
              className="rounded-[var(--radius-sm)] bg-primary px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary-dark"
            >
              My account
            </Link>
          ) : (
            <>
              <Link
                href="/account/login"
                className="hidden text-sm font-semibold text-text-medium transition-colors hover:text-text-dark sm:inline"
              >
                Sign in
              </Link>
              <Link
                href="/apply"
                className="rounded-[var(--radius-sm)] bg-primary px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary-dark"
              >
                Apply now
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
