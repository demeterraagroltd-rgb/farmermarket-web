import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { resolve } from "node:path";
import type { Db } from "@farmermarket/db";

// A real Postgres, in-process, with the project's actual migrations applied.
// Integration tests use this instead of mocking drizzle, so what they exercise
// is real SQL — joins, jsonb, enums, check constraints, transactions — and it
// never touches the Render database (the only one this project has locally).
//
// PGlite speaks the same Postgres dialect but is a different driver from the
// `postgres` one production uses; the query builder is the same, so services
// take it as `Db` — the cast below is the one place that difference is named.

// __dirname, not import.meta: the API compiles to CommonJS (tsconfig), and
// vitest provides __dirname too.
const MIGRATIONS = resolve(__dirname, "../../../../packages/db/migrations");

export interface TestDb {
  db: Db;
  close: () => Promise<void>;
}

export async function createTestDb(): Promise<TestDb> {
  const client = new PGlite();
  const db = drizzle(client);
  await migrate(db, { migrationsFolder: MIGRATIONS });
  return { db: db as unknown as Db, close: () => client.close() };
}
