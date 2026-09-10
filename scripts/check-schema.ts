import { sql } from "drizzle-orm";
import { createDb } from "@farmermarket/db";

/**
 * Diagnose (and optionally repair) a schema/migration mismatch between what
 * `drizzle-kit migrate` thinks is applied and what's actually in the target
 * database — the situation where `migrate` says "No migrations to run" but a
 * table from the latest migration is missing (usually: migrate ran against a
 * different connection than the API uses).
 *
 * Usage:
 *   DATABASE_URL="<url>" pnpm exec tsx scripts/check-schema.ts          # report only
 *   DATABASE_URL="<url>" pnpm exec tsx scripts/check-schema.ts --apply  # + create missing 0006 objects (idempotent)
 */
async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const apply = process.argv.includes("--apply");

  const db = createDb(url);

  const redacted = url.replace(/:\/\/[^@]+@/, "://***@");
  console.log("Target:", redacted);

  const [{ db: dbName }] = await db.execute<{ db: string }>(
    sql`select current_database() as db`,
  );
  console.log(`Database: ${dbName}`);

  const tables = await db.execute<{ table_name: string }>(
    sql`select table_name from information_schema.tables
        where table_schema = 'public'
          and table_name in ('users', 'phone_verifications', '__drizzle_migrations')
        order by table_name`,
  );
  const present = new Set(tables.map((r) => r.table_name));
  console.log("\nTables:");
  console.log("  users                ", present.has("users") ? "✓" : "✗ MISSING");
  console.log("  phone_verifications  ", present.has("phone_verifications") ? "✓" : "✗ MISSING");

  const col = await db.execute<{ column_name: string }>(
    sql`select column_name from information_schema.columns
        where table_schema = 'public' and table_name = 'users' and column_name = 'phone_verified_at'`,
  );
  console.log("  users.phone_verified_at", col.length ? "✓" : "✗ MISSING");

  // drizzle's log lives in the `drizzle` schema on newer drizzle-kit, or
  // public on older — try both.
  let log: Array<{ hash: string; created_at: string }> = [];
  try {
    log = await db.execute(
      sql`select hash, created_at from drizzle.__drizzle_migrations order by created_at desc limit 8`,
    );
  } catch {
    try {
      log = await db.execute(
        sql`select hash, created_at from __drizzle_migrations order by created_at desc limit 8`,
      );
    } catch {
      /* no tracking table */
    }
  }
  console.log(`\n__drizzle_migrations rows (latest ${log.length}):`);
  for (const r of log) console.log("  ", new Date(Number(r.created_at)).toISOString(), r.hash?.slice(0, 12));

  if (!apply) {
    console.log("\nReport only. Re-run with --apply to create any missing 0006 objects.");
    process.exit(0);
  }

  console.log("\n--- applying 0006 objects (IF NOT EXISTS) ---");
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "phone_verifications" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
      "phone" text NOT NULL,
      "purpose" text NOT NULL,
      "code_hash" text NOT NULL,
      "attempts" integer DEFAULT 0 NOT NULL,
      "expires_at" timestamp with time zone NOT NULL,
      "consumed_at" timestamp with time zone,
      "last_sent_at" timestamp with time zone DEFAULT now() NOT NULL,
      "created_at" timestamp with time zone DEFAULT now() NOT NULL
    )
  `);
  console.log("  phone_verifications ✓");
  await db.execute(
    sql`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "phone_verified_at" timestamp with time zone`,
  );
  console.log("  users.phone_verified_at ✓");

  // 0007 — Mono bank-linking columns. Applied here too so the baseline below
  // (which marks the log current to the latest journal entry) is truthful.
  await db.execute(
    sql`ALTER TABLE "applicant_profiles" ADD COLUMN IF NOT EXISTS "bank_linked_at" timestamp with time zone`,
  );
  await db.execute(
    sql`ALTER TABLE "applicant_profiles" ADD COLUMN IF NOT EXISTS "bank_analysis" jsonb`,
  );
  console.log("  applicant_profiles.bank_linked_at / bank_analysis ✓");

  const cols = await db.execute<{ column_name: string; data_type: string }>(
    sql`select column_name, data_type from information_schema.columns
        where table_schema = 'public' and table_name = 'phone_verifications' order by ordinal_position`,
  );
  console.log("\nphone_verifications now has:");
  for (const c of cols) console.log(`  ${c.column_name} : ${c.data_type}`);

  // Baseline the drizzle log so migrate-on-boot doesn't re-run 0006 (the DDL
  // above was applied by hand, outside drizzle-kit). drizzle only inspects
  // the single most-recent `created_at`, so a row for 0006's `when` makes it
  // treat 0006 (and everything earlier) as done.
  const { createHash } = await import("node:crypto");
  const { readFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const journal = JSON.parse(
    readFileSync(join(process.cwd(), "packages/db/migrations/meta/_journal.json"), "utf8"),
  ) as { entries: Array<{ tag: string; when: number }> };
  const latest = journal.entries[journal.entries.length - 1];
  const sqlText = readFileSync(
    join(process.cwd(), "packages/db/migrations", `${latest.tag}.sql`),
    "utf8",
  );
  const hash = createHash("sha256").update(sqlText).digest("hex");
  await db.execute(
    sql`CREATE SCHEMA IF NOT EXISTS drizzle`,
  );
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
      id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint
    )
  `);
  await db.execute(sql`
    INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
    SELECT ${hash}, ${latest.when}
    WHERE NOT EXISTS (
      SELECT 1 FROM drizzle.__drizzle_migrations WHERE created_at >= ${latest.when}
    )
  `);
  console.log(`  drizzle log baselined to ${latest.tag}`);

  console.log("\nDone — re-test POST /v1/auth/customer/otp/request.");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
