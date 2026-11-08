import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { and, asc, count, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { auditLogs, orders, recovaConsents, recovaPaymentReports, repayments, repaymentSchedules, users, type Db } from "@farmermarket/db";
import { DB } from "../../db/db.module";

export const paymentReportSchema = z.object({
  channel: z.enum(["collection", "recovery", "voluntary"]),
  sourceName: z.string().trim().min(2).max(80).transform(value => value.toLowerCase()),
  transactionReference: z.string().trim().min(3).max(120).regex(/^[A-Za-z0-9._:/-]+$/).transform(value => value.toLowerCase()),
  amountNaira: z.string().regex(/^(?:0|[1-9]\d{0,8})(?:\.\d{1,2})?$/, "Use a positive naira amount with at most two decimal places.").refine(value => Number(value) > 0),
  observedAt: z.string().datetime({ offset: true }),
  note: z.string().trim().max(500).default(""),
}).strict();
export const dismissReportSchema = z.object({ reason: z.string().trim().min(5).max(500) }).strict();
const kobo = (amount: string) => {
  const [whole, fraction = ""] = amount.split(".");
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
};

@Injectable()
export class RecovaReconciliationService {
  constructor(@Inject(DB) private readonly db: Db) {}

  async overview() {
    const loans = await this.db.select({ reference: recovaConsents.reference, mandateStatus: recovaConsents.status,
      orderId: orders.id, orderStatus: orders.status, customerName: users.fullName })
      .from(recovaConsents).innerJoin(orders, eq(orders.id, recovaConsents.orderId))
      .innerJoin(users, eq(users.id, recovaConsents.userId)).orderBy(desc(recovaConsents.createdAt)).limit(200);
    const ids = loans.map(row => row.orderId);
    const references = loans.map(row => row.reference);
    const schedules = ids.length ? await this.db.select().from(repaymentSchedules).where(inArray(repaymentSchedules.orderId, ids)) : [];
    const payments = ids.length ? await this.db.select({ orderId: repaymentSchedules.orderId, amountKobo: repayments.amountKobo })
      .from(repayments).innerJoin(repaymentSchedules, eq(repaymentSchedules.id, repayments.repaymentScheduleId))
      .where(inArray(repaymentSchedules.orderId, ids)) : [];
    const pending = references.length ? await this.db.select({ reference: recovaPaymentReports.reference, total: count(),
      amount: sql<string>`sum(${recovaPaymentReports.amountKobo})::text` }).from(recovaPaymentReports)
      .where(and(inArray(recovaPaymentReports.reference, references), eq(recovaPaymentReports.status, "needs_verification")))
      .groupBy(recovaPaymentReports.reference) : [];
    const now = Date.now();
    return { checkedAt: new Date(now).toISOString(), providerPaymentVerificationEnabled: false, automaticPostingEnabled: false, limit: 200,
      loans: loans.map(loan => {
        const rows = schedules.filter(row => row.orderId === loan.orderId);
        const scheduled = rows.reduce((sum, row) => sum + row.amountKobo, 0n);
        const recordedPaid = rows.reduce((sum, row) => sum + row.amountPaidKobo, 0n);
        const posted = payments.filter(row => row.orderId === loan.orderId).reduce((sum, row) => sum + row.amountKobo, 0n);
        const due = rows.filter(row => row.dueDate.getTime() <= now).reduce((sum, row) => sum + row.amountKobo - row.amountPaidKobo, 0n);
        const reports = pending.find(row => row.reference === loan.reference);
        return { ...loan, installmentCount: rows.length, scheduledKobo: scheduled.toString(), paidKobo: posted.toString(),
          outstandingKobo: rows.length ? (scheduled - recordedPaid).toString() : null, dueKobo: due.toString(),
          ledgerConsistent: recordedPaid === posted, pendingReports: reports?.total ?? 0, reportedKobo: reports?.amount ?? "0",
          repaymentStatus: !rows.length ? "not_booked" : recordedPaid !== posted ? "ledger_review" : scheduled === recordedPaid ? "paid_in_ledger" : posted > 0n ? "part_paid_in_ledger" : due > 0n ? "overdue_in_ledger" : "not_yet_due" };
      }) };
  }

  async detail(reference: string) {
    const [consent] = await this.db.select({ orderId: recovaConsents.orderId }).from(recovaConsents).where(eq(recovaConsents.reference, reference));
    if (!consent) throw new NotFoundException("Recova repayment setup not found.");
    const installments = await this.db.select({ id: repaymentSchedules.id, number: repaymentSchedules.installmentNumber,
      dueDate: repaymentSchedules.dueDate, amountKobo: repaymentSchedules.amountKobo, paidKobo: repaymentSchedules.amountPaidKobo })
      .from(repaymentSchedules).where(eq(repaymentSchedules.orderId, consent.orderId)).orderBy(asc(repaymentSchedules.dueDate));
    const payments = await this.db.select({ id: repayments.id, installment: repaymentSchedules.installmentNumber,
      amountKobo: repayments.amountKobo, paidAt: repayments.paidAt }).from(repayments)
      .innerJoin(repaymentSchedules, eq(repaymentSchedules.id, repayments.repaymentScheduleId))
      .where(eq(repaymentSchedules.orderId, consent.orderId)).orderBy(desc(repayments.paidAt)).limit(200);
    const reports = await this.db.select().from(recovaPaymentReports).where(eq(recovaPaymentReports.reference, reference))
      .orderBy(desc(recovaPaymentReports.reportedAt)).limit(200);
    return { reference, installments, payments, reports, checkedAt: new Date().toISOString(), limit: 200, automaticPostingEnabled: false };
  }

  async report(reference: string, staffId: string, input: z.infer<typeof paymentReportSchema>) {
    const body = paymentReportSchema.parse(input);
    if (new Date(body.observedAt).getTime() > Date.now() + 60000) throw new BadRequestException("Payment observation cannot be in the future.");
    return this.db.transaction(async tx => {
      const [consent] = await tx.select({ orderId: recovaConsents.orderId }).from(recovaConsents).where(eq(recovaConsents.reference, reference)).for("share");
      if (!consent) throw new NotFoundException("Recova repayment setup not found.");
      const [order] = await tx.select().from(orders).where(eq(orders.id, consent.orderId)).for("share");
      const [schedule] = await tx.select({ id: repaymentSchedules.id }).from(repaymentSchedules).where(eq(repaymentSchedules.orderId, consent.orderId)).limit(1);
      if (!order?.approvedAt || !schedule || ["cancelled", "rejected", "pending_approval"].includes(order.status))
        throw new ConflictException("Use an approved loan with a booked repayment schedule. Contact finance about payments for closed or unapproved orders.");
      const [report] = await tx.insert(recovaPaymentReports).values({ reference, channel: body.channel, sourceName: body.sourceName,
        transactionReference: body.transactionReference, amountKobo: kobo(body.amountNaira), observedAt: new Date(body.observedAt), note: body.note,
        reportedByStaffId: staffId }).onConflictDoNothing().returning();
      if (!report) throw new ConflictException("This source and transaction reference already have an unresolved report. Review it or dismiss an incorrect report before correcting it; no payment was posted.");
      await tx.insert(auditLogs).values({ actorStaffId: staffId, action: "recova.payment_reported", targetType: "recova_payment_report", targetId: report.id,
        metadata: { reference, channel: body.channel, amountKobo: report.amountKobo.toString(), ledgerChanged: false } });
      return { id: report.id, status: report.status, ledgerChanged: false };
    });
  }

  async dismiss(id: string, staffId: string, reason: string) {
    reason = dismissReportSchema.parse({ reason }).reason;
    return this.db.transaction(async tx => {
      const [report] = await tx.update(recovaPaymentReports).set({ status: "dismissed", dismissedAt: new Date(), dismissedByStaffId: staffId, dismissalReason: reason })
        .where(and(eq(recovaPaymentReports.id, id), eq(recovaPaymentReports.status, "needs_verification"))).returning();
      if (!report) throw new ConflictException("Report not found or already dismissed. Reload the queue.");
      await tx.insert(auditLogs).values({ actorStaffId: staffId, action: "recova.payment_report_dismissed", targetType: "recova_payment_report", targetId: id,
        metadata: { reason, ledgerChanged: false } });
      return { id, status: report.status, ledgerChanged: false };
    });
  }
}
