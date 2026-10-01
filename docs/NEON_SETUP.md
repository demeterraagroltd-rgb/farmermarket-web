# Farmer Market: fresh Neon database

Project: `rough-silence-50008592` (`farmermarket`), branch `production`,
region Frankfurt (`aws-eu-central-1`), PostgreSQL 18.

The previous Render database expired. The owner authorized a fresh start
without transferring its customers, orders, repayments, or balances.

## Prepared and verified

- All 17 committed Drizzle migrations have been applied.
- The manual maker-checker and balanced-ledger triggers are installed.
- Seeded the existing baseline: 2 categories, 4 brands, 10 products,
  3 banners, and 4 payment plans. Product images reuse existing Cloudinary URLs.
- Fees match current app/API pricing: 500 naira plus a 3% service fee.
- Initial pickup centre: Demeterra Abuja Office,
  No 6 Road 1E, Supercell Estate, Apo, Abuja. This address comes from the
  company website's contact page; staff can edit the centre in the dashboard.
- Initial super-admin: `admin@farmermarket.ng`. The generated password and
  TOTP secret are saved in the git-ignored `.env.bootstrap.local`.
- Local root and API `.env` files now use Neon. Previous versions are kept
  in git-ignored `.env.render-backup.local` files beside them.
- `.env.neon.local` contains the pooled/direct database URLs and storage
  credentials. Never commit or paste these credentials into a public issue.
- The private Neon `uploads` bucket is deployed. Existing app uploads still
  use Cloudinary; provisioning a bucket does not change the storage integration.
- Local API checks against Neon passed for staff login, catalog, payment
  plans, pickup centres, customers dashboard, and reports.
- Order submission, approval, repayment schedule, repayment, credit release,
  and deferred ledger checks were verified against Neon in a transaction that
  rolled back all test fixtures.

## Live cutover verified

The owner updated the Render API database environment values and redeployed.
Checks against `https://farmermarket-api-nsjd.onrender.com` confirmed:

- Health returned 200.
- Catalog returned the 10 seeded products, payment plans returned 4 plans,
  and pickup centres returned Demeterra Abuja Office.
- The new Neon super-admin logged in successfully. Authenticated customers,
  orders, and reports dashboard endpoints returned 200.
- The deployed website marketplace and login pages returned HTTP 200;
  browser-rendered customer checkout was not tested by these checks.

The API URL remains unchanged. New customers must register again because
the previous database's accounts were not transferred.

## Remaining source deployment

The repository's `render.yaml` now uses dashboard-managed database secrets instead
of referencing expired Render Postgres. Its CORS allow-list includes both
`https://farmermarket.ng` and `https://www.farmermarket.ng` alongside the existing
Vercel and localhost origins. Apply the updated Blueprint configuration so a
future sync preserves the Neon connection and custom-domain access. The API boot
change uses the direct connection for migrations when it is supplied; older
deployed code continues to use `DATABASE_URL` until this change is deployed.

The Flutter checkout was aligned with the existing API's pickup-centre and
pickup-date requirements. Rebuild/distribute the mobile app for those code
changes to reach installed clients. Existing installed builds do not update
automatically when the API database changes.

The expired Render database has not been deleted. Its old data is not needed
for this fresh setup.
