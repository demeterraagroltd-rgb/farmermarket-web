import { Inject, Injectable } from "@nestjs/common";
import { eq, gte, sql } from "drizzle-orm";
import { koboToNaira } from "@farmermarket/core";
import { applicantProfiles, creditProfiles, kycEvents, repaymentSchedules, type Db } from "@farmermarket/db";
import { DB } from "../../db/db.module";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The Overview dashboard's numbers (§11.4, §12) — real queries over
 * applicant_profiles / kyc_events / repayment_schedules / credit_profiles.
 *
 * Earlier versions of this sourced applications-by-day, approval rate and
 * decision speed from the `applications` / `application_decisions` tables —
 * which is the origination model the plan describes, but nothing has
 * written to it since registration moved onto applicant_profiles / the KYC
 * flow. Every metric here now reads the tables that flow actually
 * populates, so it moves when real applicants move instead of sitting at
 * zero next to real-looking SQL.
 */
@Injectable()
export class ReportsService {
  constructor(@Inject(DB) private readonly db: Db) {}

  async overview() {
    const now = new Date();
    const since30 = new Date(now.getTime() - 30 * DAY_MS);
    const par30Cutoff = new Date(now.getTime() - 30 * DAY_MS);

    const [applicationsByDay, decisions, decisionSpeed, queue, totalApplicants, portfolio, activeLimits] =
      await Promise.all([
        this.applicationsByDay(now),
        this.decisions(since30),
        this.decisionSpeedHours(since30),
        this.db
          .select({ n: sql<number>`count(*)::int` })
          .from(applicantProfiles)
          .where(eq(applicantProfiles.verificationStatus, "submitted")),
        this.db.select({ n: sql<number>`count(*)::int` }).from(applicantProfiles),
        this.portfolio(par30Cutoff),
        this.db
          .select({ n: sql<number>`count(*)::int` })
          .from(creditProfiles)
          .where(sql`${creditProfiles.creditLimitKobo} > 0`),
      ]);

    return {
      generatedAt: now.toISOString(),
      totalApplicants: totalApplicants[0]?.n ?? 0,
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
    // Last 7 days including today, keyed by date. submittedAt is when the
    // applicant hits "Submit for verification" — falls back to createdAt
    // (account creation) so an applicant who never finished submitting still
    // shows up on the day they started.
    const start = new Date(now.getTime() - 6 * DAY_MS);
    start.setHours(0, 0, 0, 0);
    const rows = await this.db
      .select({
        day: sql<string>`to_char(coalesce(${applicantProfiles.submittedAt}, ${applicantProfiles.createdAt}) at time zone 'UTC', 'YYYY-MM-DD')`,
        n: sql<number>`count(*)::int`,
      })
      .from(applicantProfiles)
      .where(gte(sql`coalesce(${applicantProfiles.submittedAt}, ${applicantProfiles.createdAt})`, start))
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

  // A "decision" is a kyc_events row landing on verified or needs_more_info
  // — the KYC flow's two outcomes (there's no separate decline; needs_more_info
  // is "send it back," not final). approved = verified.
  private async decisions(since: Date) {
    const [row] = await this.db
      .select({
        total: sql<number>`count(*)::int`,
        approved: sql<number>`count(*) filter (where ${kycEvents.toStatus} = 'verified')::int`,
      })
      .from(kycEvents)
      .where(
        sql`${kycEvents.toStatus} in ('verified', 'needs_more_info') and ${kycEvents.createdAt} >= ${since}`,
      );
    return { total: row?.total ?? 0, approved: row?.approved ?? 0 };
  }

  // For each decision event, find the most recent prior "submitted" event
  // for the same applicant and diff the timestamps — accurate across
  // resubmissions, unlike comparing against applicant_profiles.submittedAt
  // directly (that column gets overwritten on every resubmit).
  private async decisionSpeedHours(since: Date): Promise<number | null> {
    const [row] = await this.db.execute<{ hours: number | null }>(sql`
      select avg(extract(epoch from (e.created_at - sub.submitted_at)) / 3600.0) as hours
      from kyc_events e
      join lateral (
        select max(s.created_at) as submitted_at
        from kyc_events s
        where s.user_id = e.user_id and s.to_status = 'submitted' and s.created_at < e.created_at
      ) sub on sub.submitted_at is not null
      where e.to_status in ('verified', 'needs_more_info') and e.created_at >= ${since}
    `);
    const hours = row?.hours;
    return hours == null ? null : Math.round(Number(hours) * 10) / 10;
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
