import assert from "node:assert/strict";
import { test } from "node:test";
import { addToCart, getCart, setQuantity, removeFromCart, totalsOf, clearCart } from "../apps/web/src/lib/cart.ts";
import { addBundleToCart } from "../apps/web/src/lib/bundles.ts";

test("bundles stay one cart line alongside individual products, through quantity changes and removal", () => {
  const data = new Map();
  const localStorage = { getItem: (key) => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
  Object.defineProperty(globalThis, "window", { configurable: true, value: { localStorage, dispatchEvent: () => true } });
  try {
    const bundle = { id: "bundle-id", name: "Kitchen bundle", slug: "kitchen-bundle", imageUrl: "https://example.com/bundle.png",
      isAvailable: true, bundlePrice: 1700, availableQuantity: 5, itemCount: 3 };
    assert.equal(addBundleToCart(bundle, 2), true);
    assert.equal(getCart().length, 1); assert.equal(getCart()[0].quantity, 2); assert.equal(getCart()[0].product.kind, "bundle");
    addToCart({ id: "rice", name: "Rice", imageUrl: "https://example.com/rice.png", unit: "bag", price: 900 }, 1);
    assert.equal(getCart().length, 2); assert.equal(totalsOf(getCart()).subtotal, 4300);
    addBundleToCart(bundle, 1); assert.equal(getCart()[0].quantity, 3);
    setQuantity(bundle.id, 1); assert.equal(getCart()[0].quantity, 1); assert.equal(totalsOf(getCart()).subtotal, 2600);
    removeFromCart(bundle.id); assert.equal(getCart().length, 1); assert.equal(getCart()[0].product.id, "rice");
    assert.equal(addBundleToCart({ ...bundle, isAvailable: false }), false); assert.equal(getCart().length, 1);
    clearCart(); assert.equal(getCart().length, 0);
  } finally { Reflect.deleteProperty(globalThis, "window"); }
});
