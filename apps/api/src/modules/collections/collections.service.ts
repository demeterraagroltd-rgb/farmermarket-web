import { Inject, Injectable, Logger } from "@nestjs/common";
import { and, eq } from "drizzle-orm";
import { formatNaira } from "@farmermarket/core";
import { bnplPlans, orders, repaymentSchedules, users, type Db } from "@farmermarket/db";
import { DB } from "../../db/db.module";
import { EmailService } from "../notifications/email.service";
import { emails } from "../notifications/templates";
import { SMS_SENDER, type SmsSender } from "../integrations/sms/sms.types";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Whole days from `a` to `b`, both floored to midnight. +1 means b is tomorrow. */
function dayOffset(a: Date, b: Date): number {
  const floor = (d: Date) => Math.floor(d.getTime() / DAY_MS);
  return floor(b) - floor(a);
}

function shortDate(d: Date): string {
  return d.toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric" });
}

type NoticeKind = "reminder_tomorrow" | "reminder_today" | "overdue";

export interface CollectionNotice {
  scheduleId: string;
  userId: string;
  buyerName: string | null;
  kind: NoticeKind;
  daysPastDue: number;
  amountDue: string;
  channels: Array<"email" | "sms">;
}

export interface CollectionRunResult {
  ranAt: string;
  dryRun: boolean;
  scannedUnpaid: number;
  remindersDue: number;
  overdueNotices: number;
  emailsSent: number;
  smsSent: number;
  notices: CollectionNotice[];
}

/**
 * Proactive side of collections — the part that was missing. Repayment
 * schedules are written at order approval; this is what actually chases them:
 * a nudge the day before (and day of) the due date, then a weekly overdue
 * notice, escalating in tone past 30 days.
 *
 * Idempotency is by design deterministic rather than stateful (no
 * `last_notified_at` column yet): notices fire on fixed day-offsets from the
 * due date, so **one run per day** (a cron) gives each schedule each notice
 * once. Running it twice in a day double-sends; running it late just delays
 * the next weekly overdue nudge, it doesn't skip one. A `collection_events`
 * table for exactly-once + true catch-up is a later migration.
 */
@Injectable()
export class CollectionsService {
  private readonly log = new Logger("CollectionsService");

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly email: EmailService,
    @Inject(SMS_SENDER) private readonly sms: SmsSender,
  ) {}

  async run(opts: { dryRun?: boolean; now?: Date } = {}): Promise<CollectionRunResult> {
    const dryRun = opts.dryRun ?? false;
    const now = opts.now ?? new Date();

    const rows = await this.db
      .select({
        scheduleId: repaymentSchedules.id,
        userId: repaymentSchedules.userId,
        amountKobo: repaymentSchedules.amountKobo,
        amountPaidKobo: repaymentSchedules.amountPaidKobo,
        dueDate: repaymentSchedules.dueDate,
        installmentNumber: repaymentSchedules.installmentNumber,
        totalInstallments: repaymentSchedules.totalInstallments,
        buyerName: users.fullName,
        buyerEmail: users.email,
        buyerPhone: users.phone,
        planName: bnplPlans.name,
      })
      .from(repaymentSchedules)
      .innerJoin(orders, eq(repaymentSchedules.orderId, orders.id))
      .leftJoin(bnplPlans, eq(orders.bnplPlanId, bnplPlans.id))
      .leftJoin(users, eq(repaymentSchedules.userId, users.id))
      .where(and(eq(repaymentSchedules.isPaid, false)));

    const notices: CollectionNotice[] = [];
    let emailsSent = 0;
    let smsSent = 0;

    for (const r of rows) {
      const owedKobo = r.amountKobo - r.amountPaidKobo;
      if (owedKobo <= 0n) continue; // defensive: isPaid=false but nothing owed

      const offset = dayOffset(now, r.dueDate); // +1 tomorrow, 0 today, -N overdue
      const daysPastDue = offset < 0 ? -offset : 0;

      let kind: NoticeKind | null = null;
      if (offset === 1) kind = "reminder_tomorrow";
      else if (offset === 0) kind = "reminder_today";
      // Weekly overdue nudge: days 1, 8, 15, 22, 29, 36… past due.
      else if (offset < 0 && daysPastDue % 7 === 1) kind = "overdue";
      if (!kind) continue;

      const amountDue = formatNaira(owedKobo);
      const name = r.buyerName ?? "there";
      const channels: Array<"email" | "sms"> = [];

      const mail =
        kind === "overdue"
          ? emails.repaymentOverdue(name, {
              amount: amountDue,
              daysPastDue,
              installmentNumber: r.installmentNumber,
              totalInstallments: r.totalInstallments,
              severe: daysPastDue >= 30,
            })
          : emails.repaymentReminder(name, {
              amount: amountDue,
              dueLabel: kind === "reminder_tomorrow" ? "tomorrow" : "today",
              dueDate: shortDate(r.dueDate),
              installmentNumber: r.installmentNumber,
              totalInstallments: r.totalInstallments,
            });

      const smsText =
        kind === "overdue"
          ? `Demeterra: installment ${r.installmentNumber}/${r.totalInstallments} of ${amountDue} is ${daysPastDue} ${daysPastDue === 1 ? "day" : "days"} overdue. Please pay in the app.`
          : `Demeterra: ${amountDue} (installment ${r.installmentNumber}/${r.totalInstallments}) is due ${kind === "reminder_tomorrow" ? "tomorrow" : "today"}. Pay in the app.`;

      if (r.buyerEmail) {
        channels.push("email");
        if (!dryRun) {
          void this.email.send({ to: r.buyerEmail, ...mail });
          emailsSent++;
        }
      }
      if (this.sms.live && r.buyerPhone) {
        channels.push("sms");
        if (!dryRun) {
          this.sms.send(r.buyerPhone, smsText).catch((e) =>
            this.log.warn(`arrears SMS to ${r.buyerPhone} failed: ${e instanceof Error ? e.message : e}`),
          );
          smsSent++;
        }
      }

      notices.push({
        scheduleId: r.scheduleId,
        userId: r.userId,
        buyerName: r.buyerName ?? null,
        kind,
        daysPastDue,
        amountDue,
        channels,
      });
    }

    const result: CollectionRunResult = {
      ranAt: now.toISOString(),
      dryRun,
      scannedUnpaid: rows.length,
      remindersDue: notices.filter((n) => n.kind !== "overdue").length,
      overdueNotices: notices.filter((n) => n.kind === "overdue").length,
      emailsSent,
      smsSent,
      notices,
    };

    this.log.log(
      `collections run${dryRun ? " (dry)" : ""}: scanned ${result.scannedUnpaid} unpaid, ` +
        `${result.remindersDue} reminders, ${result.overdueNotices} overdue`,
    );
    return result;
  }
}
