/**
 * One-off backfill: give customers who linked a bank or ran an identity check
 * before the Mono tables existed a starting record in each, built only from
 * what their profile already holds. Calls nothing external; idempotent.
 *
 *   pnpm backfill:mono
 *
 * Reads DATABASE_URL from the root .env. Run it once, after the migration that
 * creates the Mono tables has been applied.
 */
import { backfillMonoRecords, createDb } from "@farmermarket/db";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const db = createDb(url);
backfillMonoRecords(db)
  .then((r) => {
    console.log("backfill complete:", r);
    if (r.conflicts > 0) {
      console.warn(
        `${r.conflicts} bank account(s) were skipped because the same Mono account id belongs to more than one customer — review them by hand.`,
      );
    }
    process.exit(0);
  })
  .catch((err) => {
    console.error("backfill failed:", err);
    process.exit(1);
  });
