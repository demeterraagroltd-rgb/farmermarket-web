import { Inject, Injectable, NotFoundException, ConflictException } from "@nestjs/common";
import { and, asc, desc, eq, gt, gte, ilike, lt, lte, ne, sql, type SQL } from "drizzle-orm";
import { applicantProfiles, auditLogs, bankAccounts, bankTransactions, monoRawResponses, monoSyncLogs, type Db } from "@farmermarket/db";
import { DB } from "../../db/db.module";
import type { StaffRole } from "../../common/decorators/roles.decorator";
import { analyseIncomeSources, type IncomeSourcesResult } from "../mono-data/income-sources";
import { analyseRecurringExpenses } from "../mono-data/recurring-expenses";
import { openRaw, rawStorageEnabled } from "../mono-data/raw-response";
import { buildStatement } from "../mono-data/statement-periods";
import { categoryBreakdown, detectUnusualTransactions, signalFor, type CategorizedTx } from "../mono-data/spending-signals";
import { categorizeTransaction, type TransactionCategory } from "../mono-data/transaction-categorization";
import { employerNameLooksReal, employerPaymentMatch } from "../mono-data/employer-signals";
import { nairaFromKobo, toCsv } from "./csv";
import {
  EXPORT_ROW_LIMIT,
  type IncomeSourcesQueryInput,
  type SpendingAnalysisQueryInput,
  type StatementQueryInput,
  type TransactionFilterInput,
  type TransactionListInput,
} from "./dto/financial.dto";

/** Other applicants declaring the same employer text at or above this count get a "worth a look" flag. */
const EMPLOYER_SHARED_THRESHOLD = 5;

const DAY = 86_400_000;

/**
 * Only these roles may see what Mono actually sent, or take the data out of the
 * system as a file. `credit` officers work from the parsed transactions and
 * analysis; the raw payloads and exports are an audit/debugging tool.
 */
export const RAW_ACCESS_ROLES: readonly StaffRole[] = ["super_admin", "admin"];
export const canSeeRaw = (role: StaffRole) => RAW_ACCESS_ROLES.includes(role);

const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));
const numOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

/** Escapes LIKE wildcards so a search for "50%" finds "50%", not everything. */
const likeEscape = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

const startOf = (from: string) => new Date(from);
/** A date-only end means "through that whole day". Returned as an exclusive bound. */
const endExclusive = (to: string) => new Date(Date.parse(to) + (/^\d{4}-\d{2}-\d{2}$/.test(to) ? DAY : 1));

/**
 * Reads a customer's stored Mono transactions and what is derived from them.
 *
 * Every query here is scoped by the customer id from the route — an account or
 * transaction id in the URL that belongs to someone else is a 404, never data.
 * Like the 360 read, nothing in this class ever calls Mono: it only reads what
 * a sync already stored.
 */
@Injectable()
export class CustomerFinancialService {
  constructor(@Inject(DB) private readonly db: Db) {}

  // ── Accounts ───────────────────────────────────────────────────────────

  private async accountsOf(customerId: string) {
    const rows = await this.db
      .select({
        id: bankAccounts.id,
        institution: bankAccounts.institution,
        accountName: bankAccounts.accountName,
        last4: bankAccounts.accountNumberLast4,
        status: bankAccounts.status,
      })
      .from(bankAccounts)
      .where(eq(bankAccounts.userId, customerId))
      .orderBy(asc(bankAccounts.linkedAt));
    return rows.map((a) => {
      const masked = a.last4 ? `•••• ${a.last4}` : null;
      return {
      id: a.id,
      label: `${a.institution ?? "Bank account"} ${masked ?? ""}`.trim(),
      institution: a.institution,
      accountName: a.accountName,
      accountMasked: masked,
      status: a.status,
    };
    });
  }

  /** 404 unless the account exists *and is this customer's*. */
  private async assertOwnAccount(customerId: string, accountId: string | undefined) {
    if (!accountId) return;
    const [row] = await this.db
      .select({ id: bankAccounts.id })
      .from(bankAccounts)
      .where(and(eq(bankAccounts.id, accountId), eq(bankAccounts.userId, customerId)))
      .limit(1);
    if (!row) throw new NotFoundException("Bank account not found for this customer");
  }

  // ── Transactions ───────────────────────────────────────────────────────

  private filterClauses(customerId: string, f: TransactionFilterInput): SQL[] {
    const c: SQL[] = [eq(bankTransactions.userId, customerId)];
    if (f.accountId) c.push(eq(bankTransactions.bankAccountId, f.accountId));
    if (f.type) c.push(eq(bankTransactions.direction, f.type));
    if (f.from) c.push(gte(bankTransactions.occurredAt, startOf(f.from)));
    if (f.to) c.push(lt(bankTransactions.occurredAt, endExclusive(f.to)));
    if (f.minNaira !== undefined) c.push(gte(bankTransactions.amountKobo, BigInt(Math.round(f.minNaira * 100))));
    if (f.maxNaira !== undefined) c.push(lte(bankTransactions.amountKobo, BigInt(Math.round(f.maxNaira * 100))));
    if (f.channel) c.push(eq(bankTransactions.providerCategory, f.channel));
    if (f.q) c.push(ilike(bankTransactions.narration, `%${likeEscape(f.q)}%`));
    return c;
  }

  async listTransactions(customerId: string, q: TransactionListInput) {
    await this.assertOwnAccount(customerId, q.accountId);
    const where = and(...this.filterClauses(customerId, q));

    const order = {
      newest: [desc(bankTransactions.occurredAt), desc(bankTransactions.id)],
      oldest: [asc(bankTransactions.occurredAt), asc(bankTransactions.id)],
      largest: [desc(bankTransactions.amountKobo), desc(bankTransactions.id)],
      smallest: [asc(bankTransactions.amountKobo), asc(bankTransactions.id)],
    }[q.sort];

    const [rows, [agg], accounts, [coverage], channels] = await Promise.all([
      this.db
        .select({
          id: bankTransactions.id,
          bankAccountId: bankTransactions.bankAccountId,
          direction: bankTransactions.direction,
          amountKobo: bankTransactions.amountKobo,
          narration: bankTransactions.narration,
          occurredAt: bankTransactions.occurredAt,
          balanceAfterKobo: bankTransactions.balanceAfterKobo,
          providerCategory: bankTransactions.providerCategory,
          category: bankTransactions.category,
          retrievedAt: bankTransactions.retrievedAt,
        })
        .from(bankTransactions)
        .where(where)
        .orderBy(...order)
        .limit(q.pageSize)
        .offset((q.page - 1) * q.pageSize),
      // Totals cover the whole filtered set, not just this page — the numbers an
      // analyst reads above the table must not change when they turn the page.
      this.db
        .select({
          total: sql<string>`count(*)`,
          credits: sql<string>`coalesce(sum(${bankTransactions.amountKobo}) filter (where ${bankTransactions.direction} = 'credit'), 0)`,
          debits: sql<string>`coalesce(sum(${bankTransactions.amountKobo}) filter (where ${bankTransactions.direction} = 'debit'), 0)`,
        })
        .from(bankTransactions)
        .where(where),
      this.accountsOf(customerId),
      // Coverage ignores the filters: "what do we hold for this customer at all".
      this.db
        .select({
          total: sql<string>`count(*)`,
          earliest: sql<Date | null>`min(${bankTransactions.occurredAt})`,
          latest: sql<Date | null>`max(${bankTransactions.occurredAt})`,
          dataAsOf: sql<Date | null>`max(${bankTransactions.retrievedAt})`,
        })
        .from(bankTransactions)
        .where(eq(bankTransactions.userId, customerId)),
      this.db
        .selectDistinct({ channel: bankTransactions.providerCategory })
        .from(bankTransactions)
        .where(eq(bankTransactions.userId, customerId))
        .orderBy(asc(bankTransactions.providerCategory)),
    ]);

    const total = num(agg.total);
    return {
      items: rows.map((r) => ({
        id: r.id,
        bankAccountId: r.bankAccountId,
        direction: r.direction,
        amountKobo: num(r.amountKobo),
        narration: r.narration,
        occurredAt: r.occurredAt.toISOString(),
        balanceAfterKobo: numOrNull(r.balanceAfterKobo),
        channel: r.providerCategory,
        category: r.category ?? categorizeTransaction({ narration: r.narration, direction: r.direction, channel: r.providerCategory }),
        retrievedAt: r.retrievedAt.toISOString(),
      })),
      page: q.page,
      pageSize: q.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / q.pageSize)),
      summary: { creditsKobo: num(agg.credits), debitsKobo: num(agg.debits), netKobo: num(agg.credits) - num(agg.debits) },
      coverage: {
        total: num(coverage.total),
        earliest: coverage.earliest ? new Date(coverage.earliest).toISOString() : null,
        latest: coverage.latest ? new Date(coverage.latest).toISOString() : null,
        dataAsOf: coverage.dataAsOf ? new Date(coverage.dataAsOf).toISOString() : null,
      },
      channels: channels.map((c) => c.channel).filter((c): c is string => !!c),
      accounts,
    };
  }

  /**
   * One transaction. The original Mono record (`raw`) rides along only for the
   * roles allowed to see it, and viewing it is written to the audit log.
   */
  async getTransaction(customerId: string, txId: string, staffId: string, role: StaffRole) {
    const [row] = await this.db
      .select()
      .from(bankTransactions)
      .where(and(eq(bankTransactions.id, txId), eq(bankTransactions.userId, customerId)))
      .limit(1);
    if (!row) throw new NotFoundException("Transaction not found");

    const includeRaw = canSeeRaw(role);
    if (includeRaw) {
      await this.db.insert(auditLogs).values({
        actorStaffId: staffId,
        action: "customer.transaction_raw_viewed",
        targetType: "user",
        targetId: customerId,
        metadata: { transactionId: txId },
      });
    }
    return {
      id: row.id,
      bankAccountId: row.bankAccountId,
      externalId: row.externalId,
      direction: row.direction,
      amountKobo: num(row.amountKobo),
      narration: row.narration,
      occurredAt: row.occurredAt.toISOString(),
      balanceAfterKobo: numOrNull(row.balanceAfterKobo),
      channel: row.providerCategory,
      category: row.category ?? categorizeTransaction({ narration: row.narration, direction: row.direction, channel: row.providerCategory }),
      retrievedAt: row.retrievedAt.toISOString(),
      firstSeenAt: row.firstSeenAt.toISOString(),
      raw: includeRaw ? (row.raw ?? null) : undefined,
    };
  }

  /** The filtered transactions as CSV, for the roles allowed to take data out. Audited. */
  async exportTransactionsCsv(customerId: string, f: TransactionFilterInput, staffId: string) {
    await this.assertOwnAccount(customerId, f.accountId);
    const rows = await this.db
      .select({
        id: bankTransactions.id,
        externalId: bankTransactions.externalId,
        direction: bankTransactions.direction,
        amountKobo: bankTransactions.amountKobo,
        narration: bankTransactions.narration,
        occurredAt: bankTransactions.occurredAt,
        balanceAfterKobo: bankTransactions.balanceAfterKobo,
        providerCategory: bankTransactions.providerCategory,
        category: bankTransactions.category,
      })
      .from(bankTransactions)
      .where(and(...this.filterClauses(customerId, f)))
      .orderBy(desc(bankTransactions.occurredAt), desc(bankTransactions.id))
      // One past the cap, so "exactly at the cap" and "over it" are told apart.
      .limit(EXPORT_ROW_LIMIT + 1);

    const truncated = rows.length > EXPORT_ROW_LIMIT;
    const kept = truncated ? rows.slice(0, EXPORT_ROW_LIMIT) : rows;

    await this.db.insert(auditLogs).values({
      actorStaffId: staffId,
      action: "customer.transactions_exported",
      targetType: "user",
      targetId: customerId,
      // What was asked for and how much left the system — never the rows themselves.
      metadata: {
        rows: kept.length,
        truncated,
        filters: { ...f, q: f.q ? "(text search)" : undefined },
      },
    });

    const csv = toCsv(
      ["Date (UTC)", "Description", "Type", "Amount (NGN)", "Balance after (NGN)", "Channel", "Category", "Reference"],
      kept.map((r) => [
        r.occurredAt.toISOString(),
        r.narration,
        r.direction,
        nairaFromKobo(r.amountKobo),
        nairaFromKobo(r.balanceAfterKobo),
        r.providerCategory ?? "",
        r.category ?? categorizeTransaction({ narration: r.narration, direction: r.direction, channel: r.providerCategory }),
        r.externalId,
      ]),
    );
    return { csv, rows: kept.length, truncated };
  }

  // ── Statement & income (derived from stored transactions) ──────────────

  async statement(customerId: string, q: StatementQueryInput) {
    const accounts = await this.accountsOf(customerId);
    await this.assertOwnAccount(customerId, q.accountId);
    // Running balances belong to one account; mixing two would produce a
    // meaningless opening/closing. Default to the first-linked account.
    const accountId = q.accountId ?? accounts[0]?.id;
    if (!accountId) return { accounts, accountId: null, periods: [], totals: null, range: null, dataAsOf: null };

    const [bounds] = await this.db
      .select({
        earliest: sql<Date | null>`min(${bankTransactions.occurredAt})`,
        latest: sql<Date | null>`max(${bankTransactions.occurredAt})`,
        dataAsOf: sql<Date | null>`max(${bankTransactions.retrievedAt})`,
      })
      .from(bankTransactions)
      .where(eq(bankTransactions.bankAccountId, accountId));
    if (!bounds.earliest || !bounds.latest) {
      return { accounts, accountId, periods: [], totals: null, range: null, dataAsOf: null };
    }

    const from = q.from ? startOf(q.from) : new Date(bounds.earliest);
    const to = q.to ? new Date(endExclusive(q.to).getTime() - 1) : new Date(bounds.latest);

    const rows = await this.db
      .select({
        occurredAt: bankTransactions.occurredAt,
        direction: bankTransactions.direction,
        amountKobo: bankTransactions.amountKobo,
        balanceAfterKobo: bankTransactions.balanceAfterKobo,
      })
      .from(bankTransactions)
      .where(
        and(
          eq(bankTransactions.bankAccountId, accountId),
          eq(bankTransactions.userId, customerId),
          gte(bankTransactions.occurredAt, from),
          lte(bankTransactions.occurredAt, to),
        ),
      )
      .orderBy(asc(bankTransactions.occurredAt));

    const built = buildStatement(
      rows.map((r) => ({
        occurredAt: r.occurredAt,
        direction: r.direction,
        amountKobo: num(r.amountKobo),
        balanceAfterKobo: numOrNull(r.balanceAfterKobo),
      })),
      { from, to },
    );
    return {
      accounts,
      accountId,
      ...built,
      range: { from: from.toISOString(), to: to.toISOString() },
      dataAsOf: bounds.dataAsOf ? new Date(bounds.dataAsOf).toISOString() : null,
    };
  }

  /** Shared by the income-sources route and the employer check — both group the same window of credits. */
  private async incomeSourcesFor(
    customerId: string,
    q: { accountId?: string; months: number },
    now: Date,
  ): Promise<{ creditsAnalysed: number; result: IncomeSourcesResult }> {
    const since = new Date(now);
    since.setUTCMonth(since.getUTCMonth() - q.months);

    const rows = await this.db
      .select({
        narration: bankTransactions.narration,
        amountKobo: bankTransactions.amountKobo,
        occurredAt: bankTransactions.occurredAt,
      })
      .from(bankTransactions)
      .where(
        and(
          eq(bankTransactions.userId, customerId),
          eq(bankTransactions.direction, "credit"),
          gt(bankTransactions.occurredAt, since),
          ...(q.accountId ? [eq(bankTransactions.bankAccountId, q.accountId)] : []),
        ),
      )
      .orderBy(desc(bankTransactions.occurredAt))
      .limit(20_000);

    return {
      creditsAnalysed: rows.length,
      result: analyseIncomeSources(rows.map((r) => ({ narration: r.narration, amountKobo: num(r.amountKobo), occurredAt: r.occurredAt }))),
    };
  }

  async incomeSources(customerId: string, q: IncomeSourcesQueryInput, now: Date = new Date()) {
    await this.assertOwnAccount(customerId, q.accountId);
    const { creditsAnalysed, result } = await this.incomeSourcesFor(customerId, q, now);
    return { months: q.months, creditsAnalysed, ...result };
  }

  // ── Spending analysis (Phase 5) ─────────────────────────────────────────
  // Every figure below is derived from bank_transactions in one pass over the
  // requested window — categorisation, recurring payees, loan/gambling
  // exposure, unusual amounts. Falls back to categorizing on the fly for any
  // row a sync hasn't re-touched yet (see transaction-categorization.ts).

  async spendingAnalysis(customerId: string, q: SpendingAnalysisQueryInput, now: Date = new Date()) {
    await this.assertOwnAccount(customerId, q.accountId);
    const since = new Date(now);
    since.setUTCMonth(since.getUTCMonth() - q.months);

    const rows = await this.db
      .select({
        id: bankTransactions.id,
        narration: bankTransactions.narration,
        direction: bankTransactions.direction,
        amountKobo: bankTransactions.amountKobo,
        occurredAt: bankTransactions.occurredAt,
        providerCategory: bankTransactions.providerCategory,
        category: bankTransactions.category,
      })
      .from(bankTransactions)
      .where(
        and(
          eq(bankTransactions.userId, customerId),
          gt(bankTransactions.occurredAt, since),
          ...(q.accountId ? [eq(bankTransactions.bankAccountId, q.accountId)] : []),
        ),
      )
      .orderBy(desc(bankTransactions.occurredAt))
      .limit(20_000);

    const txs: CategorizedTx[] = rows.map((r) => ({
      id: r.id,
      narration: r.narration,
      direction: r.direction,
      amountKobo: num(r.amountKobo),
      occurredAt: r.occurredAt,
      category: (r.category as TransactionCategory | null) ?? categorizeTransaction({ narration: r.narration, direction: r.direction, channel: r.providerCategory }),
    }));

    const cashFlow = buildStatement(
      txs.map((t) => ({ occurredAt: t.occurredAt, direction: t.direction, amountKobo: t.amountKobo, balanceAfterKobo: null })),
      { from: since, to: now },
    ).periods.map((p) => ({ month: p.month, creditsKobo: p.creditsKobo, debitsKobo: p.debitsKobo, netKobo: p.netKobo }));

    return {
      months: q.months,
      transactionsAnalysed: txs.length,
      categoryBreakdown: categoryBreakdown(txs),
      cashFlow,
      loanRepayment: signalFor(txs, "loan_repayment", q.months),
      loanReceived: signalFor(txs, "loan_disbursement", q.months),
      gambling: signalFor(txs, "gambling", q.months),
      recurringExpenses: analyseRecurringExpenses(
        txs.filter((t) => t.direction === "debit").map((t) => ({ narration: t.narration, amountKobo: t.amountKobo, occurredAt: t.occurredAt, category: t.category })),
      ),
      unusualTransactions: detectUnusualTransactions(txs),
    };
  }

  // ── Employer verification (heuristics only — no registry lookup) ───────

  /**
   * Two free, no-integration signals: does the declared employer's name look
   * like a placeholder, and does the customer's own bank data actually show
   * that employer paying them. Neither confirms a business is registered —
   * that needs a paid registry (CAC) lookup, deliberately out of scope.
   */
  async employerCheck(customerId: string, now: Date = new Date()) {
    const [profile] = await this.db
      .select({ employer: applicantProfiles.employer, employmentType: applicantProfiles.employmentType })
      .from(applicantProfiles)
      .where(eq(applicantProfiles.userId, customerId))
      .limit(1);
    const employer = profile?.employer?.trim() || null;
    const employmentType = profile?.employmentType ?? null;

    if (!employer) {
      return { employer: null, employmentType, nameCheck: null, payment: null, sharedWith: null };
    }

    const nameCheck = employerNameLooksReal(employer);
    const { result: income } = await this.incomeSourcesFor(customerId, { months: 6 }, now);
    const payment = employerPaymentMatch(employer, income);

    // Case/whitespace-insensitive: "Acme Foods Ltd" and "acme foods ltd " are the same declared employer.
    const [{ n }] = await this.db
      .select({ n: sql<string>`count(*)` })
      .from(applicantProfiles)
      .where(and(sql`lower(trim(${applicantProfiles.employer})) = lower(trim(${employer}))`, ne(applicantProfiles.userId, customerId)));
    const sharedCount = Number(n);

    return {
      employer,
      employmentType,
      nameCheck,
      payment: { matched: payment.matched, source: payment.source },
      sharedWith: { count: sharedCount, flagged: sharedCount >= EMPLOYER_SHARED_THRESHOLD },
    };
  }

  // ── Raw Mono responses ─────────────────────────────────────────────────

  /** What raw captures exist — metadata only, nothing decrypted. */
  async listRawResponses(customerId: string, limit: number, now: Date = new Date()) {
    const rows = await this.db
      .select({
        id: monoRawResponses.id,
        endpoint: monoRawResponses.endpoint,
        retrievedAt: monoRawResponses.retrievedAt,
        expiresAt: monoRawResponses.expiresAt,
        payloadBytes: monoRawResponses.payloadBytes,
        syncLogId: monoRawResponses.syncLogId,
        bankAccountId: monoRawResponses.bankAccountId,
        trigger: monoSyncLogs.trigger,
      })
      .from(monoRawResponses)
      .leftJoin(monoSyncLogs, eq(monoRawResponses.syncLogId, monoSyncLogs.id))
      .where(and(eq(monoRawResponses.userId, customerId), gt(monoRawResponses.expiresAt, now)))
      .orderBy(desc(monoRawResponses.retrievedAt))
      .limit(limit);
    return {
      // Whether new captures are being written at all — an empty list means
      // something different with and without a key.
      storageEnabled: rawStorageEnabled(),
      items: rows.map((r) => ({
        id: r.id,
        endpoint: r.endpoint,
        retrievedAt: r.retrievedAt.toISOString(),
        expiresAt: r.expiresAt.toISOString(),
        payloadBytes: r.payloadBytes,
        syncLogId: r.syncLogId,
        bankAccountId: r.bankAccountId,
        trigger: r.trigger,
      })),
    };
  }

  /** Decrypts one sealed response. Audited on every successful open. */
  async getRawResponse(customerId: string, rawId: string, staffId: string, now: Date = new Date()) {
    const [row] = await this.db
      .select()
      .from(monoRawResponses)
      .where(and(eq(monoRawResponses.id, rawId), eq(monoRawResponses.userId, customerId), gt(monoRawResponses.expiresAt, now)))
      .limit(1);
    // Someone else's response, an expired one and a made-up id all look the same.
    if (!row) throw new NotFoundException("Raw response not found or has expired");

    const payload = openRaw(row.payloadEncrypted);
    if (payload === null) {
      throw new ConflictException(
        "This response can't be opened with the current encryption key. It may have been sealed under a previous key.",
      );
    }
    await this.db.insert(auditLogs).values({
      actorStaffId: staffId,
      action: "customer.mono_raw_viewed",
      targetType: "user",
      targetId: customerId,
      metadata: { rawId, endpoint: row.endpoint },
    });
    return {
      id: row.id,
      endpoint: row.endpoint,
      retrievedAt: row.retrievedAt.toISOString(),
      expiresAt: row.expiresAt.toISOString(),
      payloadBytes: row.payloadBytes,
      payload,
    };
  }
}
