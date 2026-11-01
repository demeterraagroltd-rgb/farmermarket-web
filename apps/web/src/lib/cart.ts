// Client-side cart — localStorage, no server round-trip, mirroring the
// Flutter app's `Cart`/`CartNotifier` (lib/features/cart) so the same order
// ends up costing the same amount on either surface: ₦500 flat delivery fee,
// 3% service fee, both matching `OrdersService.create`'s server-side pricing
// exactly (the server re-prices on submit regardless — this is only ever a
// preview of what it will charge).
//
// Deliberately per-browser, not per-account: unlike the customer session,
// nothing here needs to sync across tabs precisely or survive a sign-out —
// a cart is what's in this browser right now, the same way it would be on
// any storefront.

import { nairaToKobo, percentOfKobo } from "@farmermarket/core";

const CART_KEY = "farmermarket_cart";
const DELIVERY_FEE_NAIRA = 500;
const SERVICE_FEE_RATE = 0.03;

export interface CartProduct {
  kind?: "product" | "bundle";
  slug?: string;
  id: string;
  name: string;
  imageUrl: string;
  unit: string;
  /** Discounted price if one is set, otherwise the list price — what the item actually costs. */
  price: number;
}

export interface CartLine {
  product: CartProduct;
  quantity: number;
}

export interface CartTotals {
  itemCount: number;
  subtotal: number;
  deliveryFee: number;
  serviceFee: number;
  total: number;
}

function read(): CartLine[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(CART_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function write(lines: CartLine[]): void {
  window.localStorage.setItem(CART_KEY, JSON.stringify(lines));
  // Same tab, immediate — `storage` only fires in other tabs.
  window.dispatchEvent(new Event("farmermarket:cart"));
}

export function getCart(): CartLine[] {
  return read();
}

export function totalsOf(lines: CartLine[]): CartTotals {
  const itemCount = lines.reduce((n, l) => n + l.quantity, 0);
  const subtotalKobo = lines.reduce((n, l) => n + nairaToKobo(l.product.price) * BigInt(l.quantity), 0n);
  const subtotal = Number(subtotalKobo) / 100;
  const deliveryFee = lines.length === 0 ? 0 : DELIVERY_FEE_NAIRA;
  const serviceFee = Number(percentOfKobo(subtotalKobo, SERVICE_FEE_RATE * 100)) / 100;
  return { itemCount, subtotal, deliveryFee, serviceFee, total: subtotal + deliveryFee + serviceFee };
}

export function addToCart(product: CartProduct, quantity = 1): CartLine[] {
  const lines = read();
  const existing = lines.find((l) => l.product.id === product.id);
  const next = existing
    ? lines.map((l) => (l.product.id === product.id ? { ...l, quantity: l.quantity + quantity } : l))
    : [...lines, { product, quantity }];
  write(next);
  return next;
}

export function setQuantity(productId: string, quantity: number): CartLine[] {
  const lines = read();
  const next =
    quantity <= 0
      ? lines.filter((l) => l.product.id !== productId)
      : lines.map((l) => (l.product.id === productId ? { ...l, quantity } : l));
  write(next);
  return next;
}

export function removeFromCart(productId: string): CartLine[] {
  return setQuantity(productId, 0);
}

export function clearCart(): void {
  write([]);
}

/** Refresh saved carts against current prices before the customer authorizes payment. */
export async function refreshCartPrices(): Promise<CartLine[]> {
  const initial = read();
  if (!initial.length) return initial;
  const base = process.env.NEXT_PUBLIC_API_URL;
  const load = async (path: string) => {
    const res = await fetch(`${base}/v1/catalog/${path}`, { cache: "no-store" });
    if (!res.ok) throw new Error("Could not check current prices. Please try again.");
    return res.json();
  };
  const [products, bundles] = await Promise.all([
    initial.some(l => l.product.kind !== "bundle") ? load("products") : [],
    initial.some(l => l.product.kind === "bundle") ? load("bundles") : [],
  ]) as [Array<{ id: string; price: number; discountPrice: number | null }>, Array<{ id: string; bundlePrice: number | null; ready: boolean }>];
  // Read again so a quantity edit made during the fetch is retained.
  const next = read().map(line => {
    const product = products.find(p => p.id === line.product.id);
    const bundle = bundles.find(p => p.id === line.product.id);
    const price = line.product.kind === "bundle" ? bundle?.ready ? bundle.bundlePrice : null : product ? product.discountPrice ?? product.price : null;
    if (price == null || !Number.isFinite(price) || price <= 0) throw new Error(`${line.product.name} is unavailable. Remove it from the cart to continue.`);
    return { ...line, product: { ...line.product, price } };
  });
  write(next);
  return next;
}
