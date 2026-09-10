import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

// The compiled migrations live at <package root>/migrations, i.e. one level
// up from dist/. This resolves whether the package is running from source
// (packages/db/dist) or from a `pnpm deploy` bundle
// (node_modules/@farmermarket/db/dist).
function migrationsFolder(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");
}

/**
 * Apply any pending migrations, then close the connection. Safe to call on
 * every API boot: drizzle records each applied migration in
 * `drizzle.__drizzle_migrations` and runs each in a transaction, so a
 * second caller (or a re-run) is a no-op. Throws if a migration fails —
 * the caller should treat that as fatal so a broken deploy doesn't serve
 * new code against an old schema.
 */
export async function runMigrations(connectionString: string): Promise<void> {
  const client = postgres(connectionString, { ssl: "prefer", max: 1 });
  try {
    await migrate(drizzle(client), { migrationsFolder: migrationsFolder() });
  } finally {
    await client.end({ timeout: 5 });
  }
}
