import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { users, applicantProfiles } from "@farmermarket/db";
import { createTestDb, type TestDb } from "./test-db";

// Proves the harness itself: the real migrations apply to an empty database
// and the tables the Customer 360 reads are there and writable.
describe("test database", () => {
  let t: TestDb;
  beforeAll(async () => {
    t = await createTestDb();
  }, 60_000);
  afterAll(async () => {
    await t.close();
  });

  it("applies every migration", async () => {
    const rows = await t.db.execute(
      sql`select count(*)::int as n from information_schema.tables where table_schema = 'public'`,
    );
    const n = (rows as unknown as { rows: Array<{ n: number }> }).rows[0].n;
    expect(n).toBeGreaterThan(20);
  });

  it("round-trips a customer and a KYC profile", async () => {
    const [u] = await t.db.insert(users).values({ phone: "2348000000001", fullName: "Test User" }).returning();
    await t.db.insert(applicantProfiles).values({ userId: u.id, fullName: "Test User", phone: "2348000000001" });
    const [p] = await t.db.select().from(applicantProfiles);
    expect(p.userId).toBe(u.id);
    expect(p.identityLookup).toBeNull();
  });
});
