import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema/index.js";

export function createDb(connectionString: string) {
  // 'prefer' negotiates SSL when the server supports/requires it (Render's
  // managed Postgres does) and falls back cleanly when it doesn't (the local
  // Docker Compose Postgres isn't configured for SSL at all) — one setting
  // that works for both without inspecting the connection string.
  const client = postgres(connectionString, { ssl: "prefer" });
  return drizzle(client, { schema });
}

export type Db = ReturnType<typeof createDb>;

// The type of the callback argument to `db.transaction(async (tx) => ...)`.
// Not identical to `Db` (drizzle's transaction object is structurally
// similar but a distinct generic type) — derived via `Parameters<>` rather
// than hand-reconstructed, so it can't drift out of sync with drizzle-orm.
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
