import { randomUUID } from "node:crypto";
import { ConflictException, Inject, Injectable, Logger } from "@nestjs/common";
import { and, eq, lt, sql } from "drizzle-orm";
import {
  applicantProfiles,
  bankAccounts,
  bankTransactions,
  financialSummaries,
  incomeProfiles,
  MONO_DATA_VERSION,
  monoRawResponses,
  monoSyncLogs,
  type Db,
} from "@farmermarket/db";
import { DB } from "../../db/db.module";
import { MONO_CLIENT, type MonoClient, type MonoIncome, type MonoTransaction, type RawCapture } from "../integrations/mono/mono.types";
import { ANALYSIS_VERSION, analyseBank, type BankAnalysis } from "../kyc/bank-analysis";
import { prepareTransactions } from "./transaction-dedupe";
import { rawExpiry, rawStorageEnabled, retentionConfig, sealRaw, transactionCutoff } from "./raw-response";

export type SyncTrigger = "link" | "customer" | "admin" | "webhook" | "system";

export interface SyncOptions {
  userId: string;
  monoAccountId: string;
  trigger: SyncTrigger;
  /** The staff member who pressed Refresh, for trigger "admin". */
  staffId?: string | null;
  now?: Date;
}

export interface SyncResult {
  status: "success" | "partial" | "failed";
  syncLogId: string;
  bankAccountId: string;
  /** The analysis now in force: the fresh one, or the previous one if nothing new could be had. */
  analysis: BankAnalysis;
  /** True when Mono gave nothing usable and the previous analysis was kept. */
  preserved: boolean;
  summaryId: string | null;
  summaryVersion: number | null;
  transactionsFetched: number;
  transactionsInserted: number;
}

// Months of transactions the analysis reads. Deliberately independent of how
// many we *store* (a rolling year): storing more must not change what
// "regular income" means, only what an admin can look back at.
const ANALYSIS_MONTHS = 6;
const CHUNK = 500;

const errCode = (e: unknown): string | undefined => {
  const x = e as { code?: string; cause?: { code?: string } };
  return x?.code ?? x?.cause?.code;
};
const short = (e: unknown): string => (e instanceof Error ? e.message : String(e)).replace(/\s+/g, " ").slice(0, 200);

/**
 * One pull from Mono → every record that pull produces.
 *
 * Network first (nothing is written while Mono is being asked), then a single
 * database transaction that writes the bank account, transactions, income
 * profile, financial snapshot, sealed raw responses and the sync log together.
 * Either the whole picture lands or none of it does, so a half-written sync can
 * never leave a snapshot pointing at transactions that aren't there.
 *
 * If Mono returns nothing usable, the last good data is kept and the attempt is
 * logged as failed — a bad afternoon at the bank must not erase a customer's
 * income history.
 */
@Injectable()
export class MonoSyncService {
  private readonly log = new Logger("MonoSync");

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(MONO_CLIENT) private readonly mono: MonoClient,
  ) {}

  /**
   * Refuses to attach a Mono account that already belongs to a different
   * customer. Two customers cannot both be the holder of one bank account, so
   * this is either a mistake or an attempt to borrow someone's income history —
   * either way it must not quietly overwrite. Call before recording a link.
   */
  async assertAccountAvailable(userId: string, monoAccountId: string): Promise<void> {
    const [existing] = await this.db
      .select({ userId: bankAccounts.userId })
      .from(bankAccounts)
      .where(eq(bankAccounts.monoAccountId, monoAccountId))
      .limit(1);
    if (existing && existing.userId !== userId) {
      throw new ConflictException("This bank account is already linked to a different customer.");
    }
  }

  async sync(opts: SyncOptions): Promise<SyncResult> {
    const { userId, monoAccountId, trigger } = opts;
    const now = opts.now ?? new Date();
    const started = Date.now();
    const retention = retentionConfig();

    await this.assertAccountAvailable(userId, monoAccountId);

    const [profile] = await this.db
      .select({
        employer: applicantProfiles.employer,
        bankAnalysis: applicantProfiles.bankAnalysis,
        bankLinkedAt: applicantProfiles.bankLinkedAt,
      })
      .from(applicantProfiles)
      .where(eq(applicantProfiles.userId, userId))
      .limit(1);

    // ── 1. Ask Mono (no writes) ──────────────────────────────────────────
    const raws: Array<{ endpoint: string; raw: unknown }> = [];
    const capture: RawCapture = (endpoint, raw) => raws.push({ endpoint, raw });

    const [detailsR, incomeR, txR] = await Promise.allSettled([
      this.mono.getAccountDetails(monoAccountId, capture),
      this.mono.getIncome(monoAccountId, capture),
      this.mono.getTransactions(monoAccountId, retention.transactionMonths, capture),
    ]);

    const errors: string[] = [];
    const endpoints: Record<string, unknown> = {};
    const details = detailsR.status === "fulfilled" ? detailsR.value : null;
    if (detailsR.status === "rejected") errors.push(`account_details: ${short(detailsR.reason)}`);
    endpoints.account_details = detailsR.status === "fulfilled" ? "ok" : "error";

    const income: MonoIncome | null = incomeR.status === "fulfilled" ? incomeR.value : null;
    if (incomeR.status === "rejected") errors.push(`income: ${short(incomeR.reason)}`);
    // "unavailable" is normal — the income product may not be enabled — and is
    // not an error; only a thrown failure is.
    endpoints.income = incomeR.status === "rejected" ? "error" : income ? "ok" : "unavailable";

    const fetched: MonoTransaction[] = txR.status === "fulfilled" ? txR.value : [];
    if (txR.status === "rejected") errors.push(`transactions: ${short(txR.reason)}`);
    endpoints.transactions = txR.status === "fulfilled" ? "ok" : "error";

    // A transaction we can't place in time can't be stored (or analysed); count
    // it rather than drop it silently.
    const dated = fetched.filter((t) => Number.isFinite(Date.parse(t.date)));
    endpoints.invalidDates = fetched.length - dated.length;

    // ── 2. Analyse (pure) ────────────────────────────────────────────────
    const analysisFrom = transactionCutoff(now, ANALYSIS_MONTHS).getTime();
    const analysis = analyseBank(
      income,
      dated.filter((t) => Date.parse(t.date) >= analysisFrom),
      {
        accountName: details?.name ?? null,
        institution: details?.institution ?? null,
        balanceKobo: details?.balanceKobo ?? null,
        employer: profile?.employer ?? null,
      },
    );
    const usable = analysis.source !== "unavailable";
    const allFailed = detailsR.status === "rejected" && incomeR.status === "rejected" && txR.status === "rejected";
    const status: SyncResult["status"] = allFailed || !usable ? "failed" : errors.length ? "partial" : "success";

    // ── 3. Persist, atomically ───────────────────────────────────────────
    const prepared = txR.status === "fulfilled" ? prepareTransactions(dated) : [];
    const syncLogId = randomUUID();

    // Two simultaneous syncs for one customer race for the next snapshot
    // version; the unique index makes the loser fail cleanly, and it simply
    // runs again and takes the next number.
    let result!: Omit<SyncResult, "syncLogId">;
    for (let attempt = 1; ; attempt++) {
      try {
        result = await this.persist({
          userId,
          monoAccountId,
          trigger,
          staffId: opts.staffId ?? null,
          now,
          syncLogId,
          started,
          status,
          errors,
          endpoints,
          details,
          income,
          analysis,
          usable,
          previousAnalysis: (profile?.bankAnalysis ?? null) as BankAnalysis | null,
          bankLinkedAt: profile?.bankLinkedAt ?? null,
          prepared,
          raws,
          retention,
          txOk: txR.status === "fulfilled",
        });
        break;
      } catch (e) {
        if (attempt < 3 && errCode(e) === "23505") continue;
        throw e;
      }
    }
    if (status === "failed") this.log.warn(`sync for ${monoAccountId} (${trigger}) failed: ${errors.join("; ") || "no usable data"}`);
    return { ...result, syncLogId };
  }

  private async persist(p: {
    userId: string;
    monoAccountId: string;
    trigger: SyncTrigger;
    staffId: string | null;
    now: Date;
    syncLogId: string;
    started: number;
    status: SyncResult["status"];
    errors: string[];
    endpoints: Record<string, unknown>;
    details: Awaited<ReturnType<MonoClient["getAccountDetails"]>> | null;
    income: MonoIncome | null;
    analysis: BankAnalysis;
    usable: boolean;
    previousAnalysis: BankAnalysis | null;
    bankLinkedAt: Date | null;
    prepared: ReturnType<typeof prepareTransactions>;
    raws: Array<{ endpoint: string; raw: unknown }>;
    retention: ReturnType<typeof retentionConfig>;
    txOk: boolean;
  }): Promise<Omit<SyncResult, "syncLogId">> {
    const { userId, monoAccountId, now, syncLogId, details } = p;

    return this.db.transaction(async (tx) => {
      // The bank account: created on first sight, refreshed from account details.
      await tx
        .insert(bankAccounts)
        .values({ userId, monoAccountId, linkedAt: p.bankLinkedAt ?? now })
        .onConflictDoNothing({ target: bankAccounts.monoAccountId });
      const [account] = await tx.select().from(bankAccounts).where(eq(bankAccounts.monoAccountId, monoAccountId)).limit(1);

      await tx
        .update(bankAccounts)
        .set({
          lastSyncAttemptAt: now,
          ...(p.status !== "failed" ? { lastSyncedAt: now } : {}),
          ...(details
            ? {
                institution: details.institution ?? account.institution,
                accountName: details.name ?? account.accountName,
                accountNumberLast4: (details.accountNumberLast4 as string | null) ?? account.accountNumberLast4,
                currency: details.currency || account.currency,
                balanceKobo: details.balanceKobo == null ? account.balanceKobo : BigInt(Math.round(details.balanceKobo)),
                balanceRetrievedAt: details.balanceKobo == null ? account.balanceRetrievedAt : now,
              }
            : {}),
          updatedAt: now,
        })
        .where(eq(bankAccounts.id, account.id));

      // Sync log first: everything below points at it.
      const inserted = await this.upsertTransactions(tx, account.id, userId, monoAccountId, p.prepared, now);
      const purgedTx = await this.purge(tx, account.id, userId, now, p.retention);

      const rawStored = rawStorageEnabled();
      const errorText = p.errors.length ? p.errors.join("; ") : null;
      await tx.insert(monoSyncLogs).values({
        id: syncLogId,
        userId,
        bankAccountId: account.id,
        monoAccountId,
        trigger: p.trigger,
        triggeredByStaffId: p.staffId,
        status: p.status,
        startedAt: new Date(p.started),
        finishedAt: new Date(),
        durationMs: Date.now() - p.started,
        endpoints: { ...p.endpoints, rawStored, retention: purgedTx },
        transactionsFetched: p.prepared.length,
        transactionsInserted: inserted,
        errorMessage: errorText,
      });

      // Sealed raw responses (none at all without a key — see raw-response.ts).
      if (rawStored) {
        for (const r of p.raws) {
          const sealed = sealRaw(r.raw);
          if (!sealed) continue;
          await tx.insert(monoRawResponses).values({
            userId,
            bankAccountId: account.id,
            monoAccountId,
            syncLogId,
            endpoint: r.endpoint,
            payloadEncrypted: sealed.encrypted,
            payloadBytes: sealed.bytes,
            retrievedAt: now,
            expiresAt: rawExpiry(now, p.retention.rawDays),
          });
        }
      }

      // Mono's own income figures, as provider facts.
      if (p.income && (p.income.monthlyIncomeKobo != null || p.income.averageIncomeKobo != null)) {
        await tx.insert(incomeProfiles).values({
          userId,
          bankAccountId: account.id,
          monoAccountId,
          syncLogId,
          monthlyIncomeKobo: p.income.monthlyIncomeKobo == null ? null : BigInt(Math.round(p.income.monthlyIncomeKobo)),
          averageIncomeKobo: p.income.averageIncomeKobo == null ? null : BigInt(Math.round(p.income.averageIncomeKobo)),
          confidence: p.income.confidence,
          lastIncomeDescription: p.income.lastIncomeDescription,
          retrievedAt: now,
        });
      }

      // The snapshot. Written when there is something new to say, or when this
      // is the very first look and nothing has ever been recorded.
      const [{ n: priorSummaries }] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(financialSummaries)
        .where(eq(financialSummaries.userId, userId));
      const hasPrior = priorSummaries > 0 || p.previousAnalysis != null;

      if (!p.usable && hasPrior) {
        // Nothing usable came back: keep what we have, and say so.
        const kept =
          p.previousAnalysis ??
          ((
            await tx
              .select({ analysis: financialSummaries.analysis })
              .from(financialSummaries)
              .where(eq(financialSummaries.userId, userId))
              .orderBy(sql`${financialSummaries.version} desc`)
              .limit(1)
          )[0]?.analysis as BankAnalysis);
        return {
          status: p.status,
          bankAccountId: account.id,
          analysis: kept,
          preserved: true,
          summaryId: null,
          summaryVersion: null,
          transactionsFetched: p.prepared.length,
          transactionsInserted: inserted,
        };
      }

      const [{ v }] = await tx
        .select({ v: sql<number>`coalesce(max(${financialSummaries.version}), 0)::int + 1` })
        .from(financialSummaries)
        .where(eq(financialSummaries.userId, userId));
      const a = p.analysis;
      const [summary] = await tx
        .insert(financialSummaries)
        .values({
          userId,
          bankAccountId: account.id,
          syncLogId,
          version: v,
          retrievedAt: now,
          computedAt: now,
          dataVersion: MONO_DATA_VERSION,
          analysisVersion: ANALYSIS_VERSION,
          source: a.source,
          monthsAnalysed: a.monthsAnalysed,
          transactionsAnalysed: p.prepared.length,
          salaryDetected: a.salaryDetected,
          estimatedMonthlyIncomeKobo: a.estimatedMonthlyIncomeKobo == null ? null : BigInt(Math.round(a.estimatedMonthlyIncomeKobo)),
          incomeConfidence: a.incomeConfidence,
          salaryRegularity: a.salaryRegularity,
          employerNameMatch: a.employerNameMatch,
          balanceKobo: a.balanceKobo == null ? null : BigInt(Math.round(a.balanceKobo)),
          currency: details?.currency || account.currency,
          analysis: a,
        })
        .returning({ id: financialSummaries.id });

      // Keep the legacy profile columns in step — the KYC review, Order Review
      // and customer list still read them, and they mirror the newest snapshot.
      await tx
        .update(applicantProfiles)
        .set({
          bankAnalysis: a,
          bankName: details?.institution ?? undefined,
          accountLast4: (details?.accountNumberLast4 as string | null | undefined) ?? undefined,
          updatedAt: now,
        })
        .where(eq(applicantProfiles.userId, userId));

      return {
        status: p.status,
        bankAccountId: account.id,
        analysis: a,
        preserved: false,
        summaryId: summary.id,
        summaryVersion: v,
        transactionsFetched: p.prepared.length,
        transactionsInserted: inserted,
      };
    });
  }

  // ── writes ─────────────────────────────────────────────────────────────

  /** Insert new transactions, refresh ones already stored. Returns how many were new. */
  private async upsertTransactions(
    tx: Parameters<Parameters<Db["transaction"]>[0]>[0],
    bankAccountId: string,
    userId: string,
    monoAccountId: string,
    prepared: ReturnType<typeof prepareTransactions>,
    now: Date,
  ): Promise<number> {
    if (prepared.length === 0) return 0;
    const known = new Set(
      (
        await tx
          .select({ id: bankTransactions.externalId })
          .from(bankTransactions)
          .where(eq(bankTransactions.bankAccountId, bankAccountId))
      ).map((r) => r.id),
    );
    const inserted = prepared.filter((p) => !known.has(p.externalId)).length;

    for (let i = 0; i < prepared.length; i += CHUNK) {
      const rows = prepared.slice(i, i + CHUNK).map(({ tx: t, externalId, synthetic }) => ({
        userId,
        bankAccountId,
        monoAccountId,
        externalId,
        externalIdSynthetic: synthetic,
        direction: t.type,
        amountKobo: BigInt(Math.round(t.amountKobo)),
        narration: t.narration ?? "",
        occurredAt: new Date(t.date),
        balanceAfterKobo: t.balanceKobo == null ? null : BigInt(Math.round(t.balanceKobo)),
        providerCategory: t.category,
        raw: t,
        retrievedAt: now,
        lastSeenAt: now,
      }));
      await tx
        .insert(bankTransactions)
        .values(rows)
        .onConflictDoUpdate({
          target: [bankTransactions.bankAccountId, bankTransactions.externalId],
          set: {
            retrievedAt: now,
            lastSeenAt: now,
            balanceAfterKobo: sql`excluded.balance_after_kobo`,
            providerCategory: sql`excluded.provider_category`,
            raw: sql`excluded.raw`,
            dataVersion: MONO_DATA_VERSION,
          },
        });
    }
    return inserted;
  }

  /** Enforce the rolling window and expire sealed raw responses. */
  private async purge(
    tx: Parameters<Parameters<Db["transaction"]>[0]>[0],
    bankAccountId: string,
    userId: string,
    now: Date,
    retention: ReturnType<typeof retentionConfig>,
  ): Promise<{ transactionsPurged: number; rawPurged: number }> {
    const oldTx = await tx
      .delete(bankTransactions)
      .where(
        and(
          eq(bankTransactions.bankAccountId, bankAccountId),
          lt(bankTransactions.occurredAt, transactionCutoff(now, retention.transactionMonths)),
        ),
      )
      .returning({ id: bankTransactions.id });
    const oldRaw = await tx
      .delete(monoRawResponses)
      .where(and(eq(monoRawResponses.userId, userId), lt(monoRawResponses.expiresAt, now)))
      .returning({ id: monoRawResponses.id });
    return { transactionsPurged: oldTx.length, rawPurged: oldRaw.length };
  }
}
