import * as argon2 from "argon2";
import { authenticator } from "otplib";
import { createDb, staff, mfaCredentials } from "@farmermarket/db";

/**
 * There's no staff-enrolment endpoint yet (that's a real feature, not a
 * script), so this is the only way to get a testable account into a fresh
 * DB. Prints the TOTP secret and a live 6-digit code so you can log in
 * immediately without a separate authenticator app for local testing.
 *
 * Usage: DATABASE_URL=... tsx scripts/seed-staff.ts you@example.com "password" super_admin
 */
async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");

  const VALID_ROLES = ["super_admin", "admin", "credit", "sales"] as const;
  const [, , email, password, role] = process.argv;
  if (!email || !password || !VALID_ROLES.includes(role as (typeof VALID_ROLES)[number])) {
    console.error(`Usage: tsx scripts/seed-staff.ts <email> <password> <${VALID_ROLES.join("|")}>`);
    process.exit(1);
  }

  const db = createDb(url);
  const passwordHash = await argon2.hash(password, { type: argon2.argon2id });

  const [account] = await db
    .insert(staff)
    .values({
      email,
      passwordHash,
      fullName: email.split("@")[0],
      role: role as (typeof VALID_ROLES)[number],
    })
    .returning();

  const secret = authenticator.generateSecret();
  await db.insert(mfaCredentials).values({
    staffId: account.id,
    secret,
    confirmedAt: new Date(), // pre-confirmed — real enrolment requires scanning + verifying first
  });

  console.log(`Created staff ${email} (${role}), id ${account.id}`);
  console.log(`TOTP secret: ${secret}`);
  console.log(`Current 6-digit code (valid ~30s): ${authenticator.generate(secret)}`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
