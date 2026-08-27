# farmermarket-web

Web + dashboard + API for Farmer Market's BNPL food-credit product. Stack
decision and full plan: [`docs/WEB_APP_PLAN.md`](../DemetarraFF/docs/WEB_APP_PLAN.md)
in the Flutter app's repo.

**This is live**, not just a local scaffold:

- Web: https://farmermarket-web-api.vercel.app
- API: https://farmermarket-api-nsjd.onrender.com (Swagger at `/docs`)

Both are on free tiers. The API spins down after 15 minutes of
inactivity and takes a few seconds to wake up on the next request — that's
expected, not a bug. The Postgres database is also on Render's free tier,
which **expires 30 days after creation** unless upgraded — worth a
calendar reminder.

## What actually works today

The real product loop (§2 of the plan) end to end, verified live against
the deployed database, not just typechecked:

1. **Apply** — a public applicant submits the form at `/apply`. No phone
   OTP, no BVN, no bank linking, no documents — those need
   Termii/Mono/S3, none of which are wired up (Mono's application is
   pending on the business side). This is the plan's own "fake adapters
   first" approach (§9.2): build everything that doesn't depend on
   third-party credentials, swap the real thing in when it lands.
2. **Decide** — staff log in (email + password + mandatory TOTP) and see
   every application at `/dashboard`, with full detail and a decision
   panel at `/dashboard/applications/[id]`.
3. **Activate** — approving an application really does write a
   `credit_profiles` row, in the same transaction as the decision and
   the audit trail. It's not just a status change.
4. **Catalog** — staff manage categories, brands, and products, and
   publish them, at `/dashboard/catalog`. Published products show up on
   the public `/marketplace` page — no admin session needed to view it.
5. **Customers** — `/dashboard/customers` shows everyone who's applied,
   with their current credit limit if they have one.
6. **Staff management** — `/dashboard/staff`, super_admin-only. Creates
   an account with a real password hash and a TOTP secret, shown once.

## What's deliberately not built yet

Not gaps found by accident — things skipped on purpose because they need
infrastructure that isn't set up:

- **Phone-verified signup.** There's no OTP step, so applying auto-creates
  a lightweight `users` row keyed by phone number. Swap for real
  Termii-verified signup once that account exists (§14).
- **Bank linking / bureau checks.** No Mono, no FirstCentral. The
  scorecard engine exists (`packages/core/src/scorecard.ts`) but nothing
  calls it yet — decisions are entirely manual.
- **Document upload.** No S3/AWS account (deliberately deferred until real
  KYC documents are actually being handled).
- **The phone app doesn't talk to any of this.** The Flutter app is still
  on mock data. Wiring it up needs the OpenAPI → Dart codegen pipeline
  (§5.6), which needs real routes to generate from — that part exists now,
  the actual codegen run doesn't.
- **Background jobs.** `apps/worker` isn't deployed (Render has no free
  tier for background workers, and there's no real job for it to run yet).
- **Everything in Phase 4+** — orders, repayments, the ledger, reports.
  These need real purchases happening, which need the phone app wired up
  first.

## Layout

```
apps/
  web/      Next.js 15 — marketing, apply form, staff auth, dashboard
  api/      NestJS — auth, RBAC guards, applications/catalog/staff/customers modules
  worker/   BullMQ consumers + cron entrypoints (not deployed yet)
packages/
  db/       Drizzle schema (single source of truth) + migrations
  contracts/ OpenAPI spec + generated TS/Dart clients (pipeline exists, not run yet)
  core/     scorecard engine, money (kobo) helpers — pure TS, no I/O
  ui/       design tokens ported from the Flutter app's app_colors.dart
render.yaml   the only Render-specific file in the repo (must live at repo root)
infra/
  docker/           Dockerfiles — the AWS-portability guarantee
  aws/              Terraform goes here once the AWS account exists
scripts/
  seed.ts        seeds bnpl_plans from the Flutter app's BnplPlan.allPlans
  seed-staff.ts  creates a staff account + pre-confirmed TOTP secret
```

## Local setup

Requires Node ≥20 and pnpm (`corepack enable` ships pnpm with Node 20+).

```bash
docker compose up -d          # Postgres, Redis, MinIO
pnpm install
pnpm --filter @farmermarket/db generate   # generate SQL from the Drizzle schema
pnpm --filter @farmermarket/db migrate    # apply it
psql $DATABASE_URL -f packages/db/manual-migrations/triggers.sql  # maker-checker + ledger-balance triggers
pnpm db:seed                   # seeds the four BNPL plans
pnpm db:seed-staff you@example.com "a-real-password" super_admin
# ^ prints a TOTP secret and a live 6-digit code — use it immediately
#   against POST /v1/auth/staff/login, since it expires in ~30s.

pnpm dev:api     # http://localhost:3001 (Swagger at /docs)
pnpm dev:web     # http://localhost:3000
pnpm dev:worker
```

## A note on testing against the live deployment

Generating a TOTP code with `otplib` in a separate step from using it
(e.g., in Bash, then pasting into a browser call) reliably loses the
~30-second window to round-trip latency, especially with Render's
free-tier cold start. The reliable approach is generating the code with
an in-browser Web Crypto TOTP implementation in the same call that uses
it — see any of the live-verification snippets in the commit history from
2026-08-27 for a working example.

## What "Phase 0 done" actually requires

Per §15 of the plan, Phase 0 isn't finished until 15–20 core UI components
exist (only tokens exist today) and the OpenAPI → Dart codegen pipeline
actually runs, not just exists. Everything else in that section — accounts
provisioned, CI green, the DB layer proven live — is now done.
