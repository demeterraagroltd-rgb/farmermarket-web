import { defineConfig } from "drizzle-kit";

// Points at the compiled output, not src/ — drizzle-kit's own TS loader
// doesn't resolve the .js-extension-pointing-at-.ts pattern the compiled
// output relies on for Node ESM (see packages/db/src's relative imports).
// Run `pnpm build` before `generate`/`migrate` (the scripts below do this).
export default defineConfig({
  schema: "./dist/schema/index.js",
  out: "./migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://farmermarket:farmermarket@localhost:5432/farmermarket",
  },
});
