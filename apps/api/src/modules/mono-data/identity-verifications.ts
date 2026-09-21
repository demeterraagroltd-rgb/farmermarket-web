import { desc, eq } from "drizzle-orm";
import { identityVerifications, MONO_DATA_VERSION, type Db } from "@farmermarket/db";
import type { IdentityCheck } from "../kyc/identity-match";

type Kind = IdentityCheck["source"];

/**
 * Append one identity check to the customer's history. Stores the comparison
 * (already stripped of the government record by matchIdentity) — never the
 * record itself, and never a full BVN or NIN.
 *
 * `staffId` is who ran it: null when the customer did (the BVN consent flow) or
 * when it ran automatically at submission.
 */
export async function recordIdentityVerification(
  db: Pick<Db, "insert">,
  input: { userId: string; check: IdentityCheck; staffId?: string | null },
): Promise<void> {
  const { check } = input;
  await db.insert(identityVerifications).values({
    userId: input.userId,
    kind: check.source,
    // NIBSS asked the BVN holder for consent; NIN and Mashup need none.
    method: check.source === "bvn" ? "otp_consent" : "no_consent",
    verdict: check.verdict,
    live: check.live,
    nameMatch: check.nameMatch,
    dateOfBirthMatch: check.dateOfBirthMatch,
    genderMatch: check.genderMatch,
    phoneMatch: check.phoneMatch,
    ninCorroborated: check.ninCorroborated,
    recordName: check.recordName,
    initiatedByStaffId: input.staffId ?? null,
    checkedAt: new Date(check.checkedAt),
    dataVersion: MONO_DATA_VERSION,
    result: check,
  });
}

/** The most recent check of each kind, newest first wins. */
export async function latestIdentityChecks(
  db: Pick<Db, "select">,
  userId: string,
): Promise<Partial<Record<Kind, IdentityCheck>>> {
  const rows = await db
    .select({ kind: identityVerifications.kind, result: identityVerifications.result })
    .from(identityVerifications)
    .where(eq(identityVerifications.userId, userId))
    .orderBy(desc(identityVerifications.checkedAt));
  const out: Partial<Record<Kind, IdentityCheck>> = {};
  for (const r of rows) if (!out[r.kind]) out[r.kind] = r.result as IdentityCheck;
  return out;
}
