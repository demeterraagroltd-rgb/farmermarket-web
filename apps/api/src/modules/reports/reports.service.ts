import { Inject, Injectable } from "@nestjs/common";
import { and, eq, gte, isNotNull, sql } from "drizzle-orm";
import { koboToNaira } from "@farmermarket/core";
import {
  applications,
  applicationDecisions,
  creditProfiles,
  repaymentSchedules,
  type Db,
} from "@farmermarket/db";
import { DB } from "../../db/db.module";

const DAY_MS = 24 * 60 * 60 * 1000;
const PENDING_STATUSES = ["submitted", "auto_checks", "info_required", "credit_review", "escalated"] as const;

/**
 * The Overview dashboard's numbers (§11.4, §12) — real queries over
 * applications / decisions / repayment_schedules / credit_profiles, replacing
 * the sample data the page shipped with. No new tables; all aggregations.
 */
@Injectable()
export class ReportsService {
  constructor(@Inject(DB) private readonly db: Db) {}

  async overview() {
    const now = new Date();
    const since30 = new Date(now.getTime() - 30 * DAY_MS);
    const par30Cutoff = new Date(now.getTime() - 30 * DAY_MS);

    const [applicationsByDay, decisions, decisionSpeed, queue, portfolio, activeLimits] =
      await Promise.all([
        this.applicationsByDay(now),
        this.decisions(since30),
        this.decisionSpeedHours(since30),
        this.db
          .select({ n: sql<number>`count(*)::int` })
          .from(applications)
          .where(sql`${applications.status} in ${sql.raw(`(${PENDING_STATUSES.map((s) => `'${s}'`).join(",")})`)}`),
        this.portfolio(par30Cutoff),
        this.db
          .select({ n: sql<number>`count(*)::int` })
          .from(creditProfiles)
          .where(sql`${creditProfiles.creditLimitKobo} > 0`),
      ]);

    return {
      generatedAt: now.toISOString(),
      applicationsByDay,
      approvalRate: {
        decided: decisions.total,
        approved: decisions.approved,
        rate: decisions.total > 0 ? decisions.approved / decisions.total : null,
        windowDays: 30,
      },
      operations: {
        queueDepth: queue[0]?.n ?? 0,
        avgDecisionHours: decisionSpeed,
      },
      portfolio,
      activeLimits: activeLimits[0]?.n ?? 0,
    };
  }

  private async applicationsByDay(now: Date) {
    // Last 7 days including today, keyed by date; submittedAt (falls back to
    // createdAt for the rare draft that never got a submittedAt).
    const start = new Date(now.getTime() - 6 * DAY_MS);
    start.setHours(0, 0, 0, 0);
    const rows = await this.db
      .select({
        day: sql<string>`to_char(coalesce(${applications.submittedAt}, ${applications.createdAt}) at time zone 'UTC', 'YYYY-MM-DD')`,
        n: sql<number>`count(*)::int`,
      })
      .from(applications)
      .where(gte(sql`coalesce(${applications.submittedAt}, ${applications.createdAt})`, start))
      .groupBy(sql`1`);

    const byDay = new Map(rows.map((r) => [r.day, r.n]));
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(start.getTime() + i * DAY_MS);
      const key = d.toISOString().slice(0, 10);
      return {
        label: d.toLocaleDateString("en-NG", { weekday: "short" }),
        date: key,
        count: byDay.get(key) ?? 0,
      };
    });
  }

  private async decisions(since: Date) {
    const [row] = await this.db
      .select({
        total: sql<number>`count(*)::int`,
        approved: sql<number>`count(*) filter (where ${applicationDecisions.outcome} = 'approved')::int`,
      })
      .from(applicationDecisions)
      .where(gte(applicationDecisions.createdAt, since));
    return { total: row?.total ?? 0, approved: row?.approved ?? 0 };
  }

  private async decisionSpeedHours(since: Date): Promise<number | null> {
    const [row] = await this.db
      .select({
        hours: sql<number | null>`avg(extract(epoch from (${applicationDecisions.createdAt} - ${applications.submittedAt})) / 3600.0)`,
      })
      .from(applicationDecisions)
      .innerJoin(applications, eq(applicationDecisions.applicationId, applications.id))
      .where(and(gte(applicationDecisions.createdAt, since), isNotNull(applications.submittedAt)));
    return row?.hours == null ? null : Math.round(Number(row.hours) * 10) / 10;
  }

  private async portfolio(par30Cutoff: Date) {
    const [outstanding] = await this.db
      .select({
        outstandingKobo: sql<string>`coalesce(sum(${repaymentSchedules.amountKobo} - ${repaymentSchedules.amountPaidKobo}), 0)`,
        par30Kobo: sql<string>`coalesce(sum(${repaymentSchedules.amountKobo} - ${repaymentSchedules.amountPaidKobo}) filter (where ${repaymentSchedules.dueDate} < ${par30Cutoff}), 0)`,
      })
      .from(repaymentSchedules)
      .where(eq(repaymentSchedules.isPaid, false));

    const [limits] = await this.db
      .select({
        issuedKobo: sql<string>`coalesce(sum(${creditProfiles.creditLimitKobo}), 0)`,
        usedKobo: sql<string>`coalesce(sum(${creditProfiles.usedCreditKobo}), 0)`,
      })
      .from(creditProfiles);

    const outstandingKobo = BigInt(outstanding?.outstandingKobo ?? "0");
    const par30Kobo = BigInt(outstanding?.par30Kobo ?? "0");
    const issuedKobo = BigInt(limits?.issuedKobo ?? "0");
    const usedKobo = BigInt(limits?.usedKobo ?? "0");

    return {
      outstanding: koboToNaira(outstandingKobo),
      limitsIssued: koboToNaira(issuedKobo),
      utilisation: issuedKobo > 0n ? Number(usedKobo) / Number(issuedKobo) : null,
      par30: koboToNaira(par30Kobo),
      par30Rate: outstandingKobo > 0n ? Number(par30Kobo) / Number(outstandingKobo) : null,
    };
  }
}
