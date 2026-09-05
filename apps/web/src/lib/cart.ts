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

const CART_KEY = "farmermarket_cart";
const DELIVERY_FEE_NAIRA = 500;
const SERVICE_FEE_RATE = 0.03;

export interface CartProduct {
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
  const subtotal = lines.reduce((n, l) => n + l.product.price * l.quantity, 0);
  const deliveryFee = lines.length === 0 ? 0 : DELIVERY_FEE_NAIRA;
  const serviceFee = Math.round(subtotal * SERVICE_FEE_RATE);
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
