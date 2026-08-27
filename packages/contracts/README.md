# @farmermarket/contracts

Single source of truth for the API surface (§5.6): the NestJS app in
`apps/api` annotates its controllers with `@nestjs/swagger` decorators,
which produce an OpenAPI 3.1 spec. That spec generates two clients:

1. **`openapi-typescript`** → `src/generated/schema.d.ts`, consumed by
   `apps/web` alongside Zod schemas for form validation.
2. **`openapi-generator` (`dart-dio` template)** → a Dart client for the
   Flutter app, replacing the hand-written models it uses today.

## Pipeline (not yet wired to CI)

```bash
pnpm --filter @farmermarket/contracts generate:spec        # writes openapi.json
pnpm --filter @farmermarket/contracts generate:ts-client
pnpm --filter @farmermarket/contracts generate:dart-client  # needs Java + openapi-generator-cli
```

The plan (§5.6) calls for a CI contract test that fails the build if the
spec and the Dart client drift — that check doesn't exist yet; add it once
`apps/api` has real routes to generate from.
