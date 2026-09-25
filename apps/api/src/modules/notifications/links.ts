// Where the customer-facing web app lives. Every customer email links back
// into it, so the API needs to know the URL — apps/web/src/app/layout.tsx
// keeps its own copy for metadata tags, and the API can't import from there.
//
// Unset ⇒ fall back to the production deployment rather than emit relative
// links, which an email client has nothing to resolve against. Set
// WEB_BASE_URL explicitly in every non-production environment (render.yaml,
// .env.example), or a staging email will send customers to production.

const FALLBACK_WEB_BASE_URL = "https://farmermarket-web-api.vercel.app";

function page(path: string): string {
  const base = (process.env.WEB_BASE_URL ?? FALLBACK_WEB_BASE_URL).replace(/\/+$/, "");
  return `${base}${path}`;
}

// Read at call time, not module load, so a test can point these somewhere else.
// Every path here must be a route that actually exists in apps/web — an email
// that 404s is worse than one with no link at all.
export const customerLinks = {
  /** The application wizard — where verification is completed or corrected. */
  apply: () => page("/apply"),
  /** Account home: verification status, orders, repayments. */
  account: () => page("/account"),
  /** The marketplace — the "you're approved, go shop" destination. */
  marketplace: () => page("/marketplace"),
  /** Account page with the Orders tab open. */
  orders: () => page("/account?tab=orders"),
  /** One specific order. */
  order: (orderId: string) => page(`/account/orders/${encodeURIComponent(orderId)}`),
  /** Account page with the Repayments tab open. */
  repayments: () => page("/account?tab=repayments"),
};

// Staff-facing: the dashboard lives on the same web deployment.
export const staffLinks = {
  /** Inventory table — stock levels, lots, receive and adjust. */
  inventory: () => page("/dashboard/inventory"),
};
