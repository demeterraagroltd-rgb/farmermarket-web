# Product bundles

Implemented in the existing Next.js marketplace, NestJS API and Drizzle PostgreSQL database. Individual products keep their existing routes and cart format. The Flutter app's existing individual-product requests remain valid; bundle shopping UI is currently a web feature.

## Display and manage bundles

Open **Admin → Bundles** (`/dashboard/bundles`). Create or edit a bundle, choose existing products and quantities, set its selling price, and upload one composite image through the existing catalog uploader. Set **Published** to expose it publicly. Set **Featured on marketplace** to include it in the first three featured cards.

Published bundles appear under the marketplace **Bundles** category. Featured bundles appear in **Save More With Bundles** above the individual products when viewing All without a search query. Clicking View Bundle opens `/marketplace/bundles/[slug]`. The detail page links to each included product and adds the bundle as one cart line. Draft previews require an admin token and cannot make an inactive draft purchasable.

Publishing requires a composite image, at least one real included product, no unresolved product mappings, and a positive price no higher than the current combined value. No frontend image collage or new product records are generated. Stock is independent of publishing: a published bundle can become unavailable when a component is out of stock or unpublished.

## Database and API

Migration `0017_true_jack_power.sql` creates `bundles` and `bundle_items`. Bundles store their name, unique slug, description, optional image and draft price, collection, featured/active flags, unresolved mappings and internal pricing note. Component rows reference existing product IDs and positive quantities; a product can appear only once per bundle.

`order_items` gains `bundle_id` and a JSONB `components` snapshot. Existing name, image, quantity and unit-price columns snapshot the purchased bundle itself. Component snapshots include product ID, name, image, unit, per-bundle quantity and exact price in kobo as a JSON-safe string. API responses also expose total component quantities for fulfilment. `orders.stock_reserved` records whether stock has been deducted. Existing orders default to false and are not retrospectively deducted or replenished.

Public endpoints: `GET /v1/catalog/bundles` and `GET /v1/catalog/bundles/:slug`. Admin endpoints: `GET/POST /v1/admin/catalog/bundles` and `PATCH /v1/admin/catalog/bundles/:id`. Admin writes and draft reads use the existing JWT and admin/super-admin guards. Existing product image upload permissions and file validation are reused.

Checkout items must identify exactly one `productId` or `bundleId`, plus a positive integer quantity. Client-supplied prices and component definitions are never accepted by checkout.

## Pricing

The combined regular price is calculated every read from each component's current effective price (discount price when present, otherwise list price), multiplied by its quantity. Savings equals combined value minus the bundle selling price; a percentage is calculated too. Bundle selling prices are explicitly administered and do not automatically change when a component price changes. If the bundle price exceeds the current combined value, checkout is disabled until the price is reviewed.

Checkout re-prices from the database using exact bigint kobo. Individual discounted prices are now applied on the server as well, matching the existing web cart. Past order prices and contents use their snapshots, so later bundle edits cannot rewrite an order.

## Inventory and orders

There is one stock source: `products.stockQuantity`. A bundle's available quantity is the minimum of `floor(component stock / required quantity)` across published, available components.

At checkout, the transaction locks bundle definitions and shared product rows in consistent ID order. It aggregates demand across all individual and bundle lines, including overlaps, checks available stock, and deducts stock atomically. Failed checkout validation rolls back every deduction. Rejection or cancellation returns quantities from the purchase snapshots once. Closing an order prevents reopening it and releasing stock repeatedly. Approval does not deduct stock a second time; delivery keeps the deducted stock.

The browser cart uses the existing localStorage mechanism. A bundle line is marked `kind: "bundle"`, with the bundle ID, slug, name, image, unit label and preview price. Increasing its quantity still leaves one line. Checkout expands components internally for stock, while customer and staff order screens display one bundle line and its included quantities.

## Sample data and deployment

`scripts/seed-bundles.mts` creates Family Kitchen, Essential Food, Quick Meal and Monthly Grocery using real existing products. It never overwrites an existing bundle. The initial mapped products were Big Bull Rice 10kg, Kings Oil 1L, regular Indomie carton, Tasty Tom carton and Semovita 10kg where relevant. Missing Maggi was explicitly recorded, without an invented ID.

The user authorized provisional prices. The seed applies approximately 5% off mapped products, rounded down to ₦100: ₦28,500 / ₦25,800 / ₦17,500 / ₦41,700. These were created as drafts without composite images. Prices exclude unresolved components and must be reviewed after adding them. Subsequent admin edits, supplied images and publication are preserved. During verification, Family Kitchen, Essential Food and Quick Meal were already published with supplied images and Star Maggi mappings added.

The migration and four sample drafts have already been applied to the configured Neon database. No environment values were changed and no new environment variables are required. Cloudinary continues to use the existing configuration. Code changes still require the normal API/web deployment to appear on the online site. The API's existing boot migration runner applies this migration automatically in another environment.

For a different database, build the DB package and run the existing migration command with that environment's `DATABASE_URL` (prefer the unpooled connection for migrations), then seed:

```sh
pnpm --filter @farmermarket/db build
pnpm db:migrate
node --env-file=.env --import=tsx scripts/seed-bundles.mts
```

## Verification

- Actual migration and PostgreSQL SQL integration tests cover calculated prices, limiting component stock, mixed-cart demand, quantity multiplication, snapshot persistence, rollback, unpublished/inactive components, draft validation, rejection and cancellation, and individual discounted purchases.
- API suite: 450 tests passed with `pnpm --filter @farmermarket/api exec vitest run --maxWorkers=2 --minWorkers=1 --testTimeout=20000`. Default full-suite runs timed out in the existing OTP wrong-attempt test under CPU load; that test also passed independently. Core suite: 15 tests passed.
- Cart test: `node --import=tsx scripts/test-bundle-cart.mjs` passes; checks one bundle line alongside products, repeated additions, quantities, removal and unavailable bundles.
- `pnpm typecheck` and `pnpm build` both passed after the final source edits.
- Existing `pnpm lint` is blocked because the repository has no ESLint 9 configuration file. No lint configuration or unrelated dependency changes were introduced.
- Browser checks confirm public published cards, detail links/contents, add-to-cart, quantity changes and removal while preserving the pre-existing individual-product cart. Responsive checks at 375/768/1280 pixels confirmed one/two/three bundle columns with no horizontal overflow. Real checkout writes were tested in an isolated database, not by placing a chargeable customer order.

## Changed files

Database:

- `packages/db/src/schema/bundles.ts` — entities and component snapshot type.
- `packages/db/src/schema/commerce.ts` — order snapshot and reservation fields.
- `packages/db/src/schema/index.ts` — bundle exports.
- `packages/db/migrations/0017_true_jack_power.sql` — migration.
- `packages/db/migrations/meta/0017_snapshot.json` — generated schema snapshot.
- `packages/db/migrations/meta/_journal.json` — generated migration journal.

API:

- `apps/api/src/modules/catalog/bundle-pricing.ts` — shared pricing/availability calculation.
- `apps/api/src/modules/catalog/bundles.service.ts` — real reads, transactional admin writes and publishing checks.
- `apps/api/src/modules/catalog/dto/bundle.dto.ts` — input validation.
- `apps/api/src/modules/catalog/catalog.controller.ts` — public bundle endpoints.
- `apps/api/src/modules/catalog/admin-catalog.controller.ts` — guarded management endpoints.
- `apps/api/src/modules/catalog/catalog.module.ts` — service registration.
- `apps/api/src/modules/catalog/catalog.service.ts` — public individual availability reflects stock.
- `apps/api/src/modules/orders/dto/create-order.dto.ts` — product-or-bundle checkout input.
- `apps/api/src/modules/orders/order-inventory.ts` — atomic stock aggregation/reservation and snapshot-based release.
- `apps/api/src/modules/orders/orders.service.ts` — bundle snapshots, exact pricing and lifecycle integration.
- `apps/api/src/modules/orders/bundles.integration.test.ts` — nine SQL integration tests.

Web:

- `apps/web/src/lib/bundles.ts` — API types, fetching and cart helper.
- `apps/web/src/lib/cart.ts` — backwards-compatible bundle metadata.
- `apps/web/src/components/marketplace/BundleCard.tsx` — reusable cards, grid and savings badge.
- `apps/web/src/app/marketplace/page.tsx` — category, featured section and bundle grid.
- `apps/web/src/app/marketplace/bundles/[slug]/page.tsx` — details, contents and guarded draft preview.
- `apps/web/src/app/marketplace/[id]/page.tsx` — individual add button checks stock.
- `apps/web/src/app/cart/page.tsx` — bundle links/labels, contained images and wrapping cart rows.
- `apps/web/src/app/checkout/page.tsx` — sends bundle identity as one line.
- `apps/web/src/app/checkout/confirmation/page.tsx` — bundle keys and purchased contents.
- `apps/web/src/app/account/orders/[orderId]/page.tsx` — bundle keys and historical contents.
- `apps/web/src/app/(dashboard)/layout.tsx` — permitted Bundles navigation.
- `apps/web/src/app/(dashboard)/dashboard/bundles/page.tsx` — creation/editing/upload/preview/publishing.
- `apps/web/src/app/(dashboard)/dashboard/orders/page.tsx` — purchased component quantities.
- `apps/web/src/app/(dashboard)/dashboard/orders/[orderId]/review/page.tsx` — purchased component quantities.

Scripts/documentation:

- `scripts/seed-bundles.mts` — non-destructive sample seed.
- `scripts/test-bundle-cart.mjs` — cart behaviour verification.
- `docs/product-bundles.md` — this implementation and operations guide.
