import { eq, sql } from "drizzle-orm";
import type { Db } from "./client.js";
import { applicantProfiles } from "./schema/kyc.js";
import {
  bankAccounts,
  financialSummaries,
  identityVerifications,
  MONO_DATA_VERSION,
} from "./schema/mono.js";

// One-off: give customers who linked a bank or ran an identity check *before*
// the Mono tables existed a starting record in each — built only from what the
// profile row already holds. It calls nothing external.
//
// Not recoverable, because they were never stored: transactions and raw
// responses. Those appear at the customer's next sync.
//
// Idempotent, and it never overwrites: a customer who already has a bank
// account row, a snapshot, or an identity check keeps exactly what they have.

export interface BackfillResult {
  bankAccounts: number;
  summaries: number;
  identityChecks: number;
  /** Accounts skipped because the Mono account id already belongs to someone else. */
  conflicts: number;
}

interface StoredAnalysis {
  pulledAt?: string;
  accountName?: string | null;
  institution?: string | null;
  balanceKobo?: number | null;
  monthsAnalysed?: number;
  salaryDetected?: boolean;
  estimatedMonthlyIncomeKobo?: number | null;
  incomeConfidence?: string | null;
  salaryRegularity?: string | null;
  employerNameMatch?: boolean | null;
  source?: string;
}

interface StoredCheck {
  checkedAt: string;
  source: "bvn" | "nin" | "mashup";
  live: boolean;
  recordName: string | null;
  nameMatch: string | null;
  dateOfBirthMatch: boolean | null;
  genderMatch: boolean | null;
  phoneMatch: boolean | null;
  ninCorroborated: boolean | null;
  verdict: "match" | "partial" | "mismatch";
}

const bigOrNull = (n: number | null | undefined) => (n == null ? null : BigInt(Math.round(n)));
const dateOr = (iso: string | undefined, fallback: Date) => {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(t) ? new Date(t) : fallback;
};

export async function backfillMonoRecords(db: Db, now: Date = new Date()): Promise<BackfillResult> {
  const result: BackfillResult = { bankAccounts: 0, summaries: 0, identityChecks: 0, conflicts: 0 };

  const profiles = await db
    .select()
    .from(applicantProfiles)
    .where(
      sql`${applicantProfiles.monoAccountId} IS NOT NULL OR ${applicantProfiles.bankAnalysis} IS NOT NULL OR ${applicantProfiles.identityLookup} IS NOT NULL`,
    );

  for (const p of profiles) {
    const analysis = (p.bankAnalysis ?? null) as StoredAnalysis | null;

    await db.transaction(async (tx) => {
      // ── bank account ───────────────────────────────────────────────────
      let accountId: string | null = null;
      if (p.monoAccountId) {
        const [existing] = await tx
          .select({ id: bankAccounts.id, userId: bankAccounts.userId })
          .from(bankAccounts)
          .where(eq(bankAccounts.monoAccountId, p.monoAccountId))
          .limit(1);
        if (existing && existing.userId !== p.userId) {
          result.conflicts += 1;
        } else if (existing) {
          accountId = existing.id;
        } else {
          const pulled = dateOr(analysis?.pulledAt, now);
          const [row] = await tx
            .insert(bankAccounts)
            .values({
              userId: p.userId,
              monoAccountId: p.monoAccountId,
              institution: p.bankName ?? analysis?.institution ?? null,
              accountName: analysis?.accountName ?? null,
              accountNumberLast4: p.accountLast4 ?? null,
              balanceKobo: bigOrNull(analysis?.balanceKobo),
              balanceRetrievedAt: analysis?.balanceKobo == null ? null : pulled,
              linkedAt: p.bankLinkedAt ?? now,
              lastSyncedAt: analysis ? pulled : null,
            })
            .returning({ id: bankAccounts.id });
          accountId = row.id;
          result.bankAccounts += 1;
        }
      }

      // ── first financial snapshot ───────────────────────────────────────
      if (analysis) {
        const [{ n }] = await tx
          .select({ n: sql<number>`count(*)::int` })
          .from(financialSummaries)
          .where(eq(financialSummaries.userId, p.userId));
        if (n === 0) {
          const pulled = dateOr(analysis.pulledAt, now);
          await tx.insert(financialSummaries).values({
            userId: p.userId,
            bankAccountId: accountId,
            syncLogId: null, // there was no logged sync — this is a reconstruction
            version: 1,
            retrievedAt: pulled,
            computedAt: now,
            dataVersion: MONO_DATA_VERSION,
            analysisVersion: 1,
            source: analysis.source ?? "unavailable",
            monthsAnalysed: analysis.monthsAnalysed ?? 0,
            transactionsAnalysed: 0, // not knowable — transactions weren't stored
            salaryDetected: analysis.salaryDetected ?? false,
            estimatedMonthlyIncomeKobo: bigOrNull(analysis.estimatedMonthlyIncomeKobo),
            incomeConfidence: analysis.incomeConfidence ?? null,
            salaryRegularity: analysis.salaryRegularity ?? null,
            employerNameMatch: analysis.employerNameMatch ?? null,
            balanceKobo: bigOrNull(analysis.balanceKobo),
            analysis,
          });
          result.summaries += 1;
        }
      }

      // ── identity check ─────────────────────────────────────────────────
      const check = (p.identityLookup ?? null) as StoredCheck | null;
      if (check) {
        const [{ n }] = await tx
          .select({ n: sql<number>`count(*)::int` })
          .from(identityVerifications)
          .where(eq(identityVerifications.userId, p.userId));
        if (n === 0) {
          await tx.insert(identityVerifications).values({
            userId: p.userId,
            kind: check.source,
            method: check.source === "bvn" ? "otp_consent" : "no_consent",
            verdict: check.verdict,
            live: check.live,
            nameMatch: check.nameMatch,
            dateOfBirthMatch: check.dateOfBirthMatch,
            genderMatch: check.genderMatch,
            phoneMatch: check.phoneMatch,
            ninCorroborated: check.ninCorroborated,
            recordName: check.recordName,
            initiatedByStaffId: null, // who ran it wasn't recorded
            checkedAt: dateOr(check.checkedAt, now),
            dataVersion: MONO_DATA_VERSION,
            result: check,
          });
          result.identityChecks += 1;
        }
      }
    });
  }
  return result;
}

