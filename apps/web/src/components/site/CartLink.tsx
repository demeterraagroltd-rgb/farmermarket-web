"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getCart, totalsOf } from "../../lib/cart";
import { CartIcon } from "../ui/icons";

// The web equivalent of the Flutter app's cart bar — a persistent, always-
// visible way into `/cart`. That one was missing entirely on mobile until
// today (checkout was unreachable); this one exists from the start so the
// same mistake doesn't repeat here.
export function CartLink() {
  const [count, setCount] = useState(0);

  useEffect(() => {
    const sync = () => setCount(totalsOf(getCart()).itemCount);
    sync();
    window.addEventListener("storage", sync);
    window.addEventListener("farmermarket:cart", sync);
    return () => {
      window.removeEventListener("storage", sync);
      window.removeEventListener("farmermarket:cart", sync);
    };
  }, []);

  return (
    <Link
      href="/cart"
      className="relative flex h-9 w-9 items-center justify-center rounded-full text-text-medium transition-colors hover:bg-surface hover:text-text-dark"
      aria-label={count === 0 ? "Cart, empty" : `Cart, ${count} items`}
    >
      <CartIcon className="h-5 w-5" />
      {count > 0 && (
        <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-gold px-1 text-[10px] font-bold text-white">
          {count > 9 ? "9+" : count}
        </span>
      )}
    </Link>
  );
}
