# farmermarket-web

Web + dashboard + API for Farmer Market's BNPL food-credit product. Stack
decision and full plan: [`docs/WEB_APP_PLAN.md`](../DemetarraFF/docs/WEB_APP_PLAN.md)
in the Flutter app's repo. This is Phase 0 of that plan — a local-runnable
scaffold, not a deployed system.

**What's real here:** the monorepo structure, the Postgres schema (Drizzle),
a working staff-login flow (argon2id + TOTP + JWT), one role-gated API
route with unit-tested guards (13 authz tests, all passing), Docker
Compose for local Postgres/Redis/MinIO, and route-group skeletons for the
Next.js app. Every package — `api`, `web`, `worker`, `db`, `core`, `ui` —
typechecks, builds, and (where there's logic to test) passes its tests.
**What's not:** any Render/Vercel/AWS account (those need you to sign up
— nothing here can create them; also, by your own call, storage/AWS is
deliberately deferred until real KYC document uploads are actually being
built), the application wizard, the dashboard, and the OpenAPI → Dart
client pipeline (needs real routes to generate from first). It has also
never been run against a real Postgres — no Docker on this machine at
scaffold time — so the DB layer is typechecked and reviewed, not yet
exercised end to end.

## Layout

```
apps/
  web/      Next.js 15 — marketing, apply wizard, staff auth, dashboard
  api/      NestJS — auth, RBAC guards, Drizzle-backed routes
  worker/   BullMQ consumers + cron entrypoints
packages/
  db/       Drizzle schema (single source of truth) + migrations
  contracts/ OpenAPI spec + generated TS/Dart clients (pipeline only, not wired to CI yet)
  core/     scorecard engine, money (kobo) helpers — pure TS, no I/O
  ui/       design tokens ported from the Flutter app's app_colors.dart
infra/
  render.yaml       the only Render-specific file in the repo
  docker/           Dockerfiles — the AWS-portability guarantee
  aws/              Terraform goes here once the AWS account exists
scripts/
  seed.ts        seeds bnpl_plans from the Flutter app's BnplPlan.allPlans
  seed-staff.ts  creates a staff account + pre-confirmed TOTP secret for local login testing
```

## Local setup

Requires Node ≥20 and pnpm (`corepack enable` ships pnpm with Node 20+).

```bash
docker compose up -d          # Postgres, Redis, MinIO
pnpm install
pnpm --filter @farmermarket/db generate   # generate SQL from the Drizzle schema
pnpm --filter @farmermarket/db migrate    # apply it
psql $DATABASE_URL -f packages/db/migrations/0001_manual_triggers.sql  # maker-checker + ledger-balance triggers
pnpm db:seed                   # seeds the four BNPL plans
pnpm db:seed-staff you@example.com "a-real-password" super_admin
# ^ prints a TOTP secret and a live 6-digit code — use it immediately
#   against POST /v1/auth/staff/login, since it expires in ~30s.

pnpm dev:api     # http://localhost:3001 (Swagger at /docs)
pnpm dev:web     # http://localhost:3000
pnpm dev:worker
```

None of this has been run against a live Postgres yet (no Docker on the
machine this was scaffolded on) — `pnpm typecheck` and `pnpm test` are
green, but treat the `db generate`/`migrate`/seed commands above as
untested until someone actually runs them once.

## What "Phase 0 done" actually requires

Per §15 of the plan, Phase 0 isn't finished until:

- Render + Vercel accounts are provisioned (manual, needs you) — AWS is intentionally deferred until real KYC uploads are being built
- CI actually runs green in GitHub Actions (workflow exists and mirrors commands verified locally — typecheck/test/build all pass — but the workflow itself has never executed in CI)
- The OpenAPI → TS + Dart codegen pipeline is wired up against real routes
- 15–20 core UI components exist (only tokens exist today)
- The DB layer runs against a real Postgres at least once (schema + manual trigger migration have been reviewed and typechecked, not executed)

This scaffold gets the foundations in place; it doesn't close the phase by itself.
