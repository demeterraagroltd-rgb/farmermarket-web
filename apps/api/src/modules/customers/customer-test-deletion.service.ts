import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { eq, inArray } from "drizzle-orm";
import * as s from "@farmermarket/db";
import { DB } from "../../db/db.module";
import { releaseOrderStock } from "../orders/order-inventory";

/** Explicitly confirmed test-data reset, distinct from ordinary account removal.
 * Never removes a submitted provider request, repayment, or debit attempt.
 * Stock and security audit histories remain with their historical references. */
@Injectable()
export class CustomerTestDeletionService {
  constructor(@Inject(DB) private readonly db: s.Db) {}

  private async inspect(id: string, tx: s.Db | s.Tx) {
    const [user] = await tx.select().from(s.users).where(eq(s.users.id, id));
    if (!user) throw new NotFoundException("Customer not found");
    const orders = await tx.select().from(s.orders).where(eq(s.orders.userId, id)).orderBy(s.orders.id);
    const schedules = await tx.select().from(s.repaymentSchedules).where(eq(s.repaymentSchedules.userId, id));
    const mandates = await tx.select({ id: s.debitMandates.id }).from(s.debitMandates).where(eq(s.debitMandates.userId, id));
    const attempts = await tx.select({ id: s.debitAttempts.id }).from(s.debitAttempts).where(eq(s.debitAttempts.userId, id));
    const recova = await tx.select().from(s.recovaConsents).where(eq(s.recovaConsents.userId, id));
    const repayments = schedules.length ? await tx.select({ id: s.repayments.id }).from(s.repayments).where(inArray(s.repayments.repaymentScheduleId, schedules.map(row => row.id))) : [];
    const applications = await tx.select({ id: s.applications.id }).from(s.applications).where(eq(s.applications.userId, id));
    const blockers: string[] = [];
    if (!user.deactivatedAt) blockers.push("Suspend the account before permanently deleting test data.");
    if (mandates.length || attempts.length) blockers.push("A Mono mandate or debit attempt exists. Resolve provider records through a separate reviewed process.");
    if (recova.some(row => row.status !== "draft" || row.submittedAt !== null)) blockers.push("A Recova request has left draft status. Resolve the provider request before account removal.");
    if (repayments.length || schedules.some(row => row.amountPaidKobo !== 0n || row.isPaid)) blockers.push("Recorded payments exist. Financial history cannot be removed by test reset.");
    if (orders.some(row => ["preparing", "on_the_way", "delivered"].includes(row.status))) blockers.push("An order has entered fulfilment. Test reset is unavailable.");
    return { user, orders, schedules, applications, recova, blockers };
  }

  async preview(id: string) {
    const data = await this.inspect(id, this.db);
    return this.summary(data);
  }

  private summary(data: Awaited<ReturnType<CustomerTestDeletionService["inspect"]>>) {
    return {
      id: data.user.id, name: data.user.fullName ?? "Customer", allowed: data.blockers.length === 0, blockers: data.blockers,
      orders: data.orders.length, repaymentSchedules: data.schedules.length, applications: data.applications.length,
      recovaDrafts: data.recova.length,
      outstandingKobo: data.schedules.reduce((sum, row) => sum + row.amountKobo - row.amountPaidKobo, 0n).toString(),
      confirmation: `DELETE ${data.user.id}`,
      retained: "Security audit and inventory movement history remain. This removes the application account and linked test records; it does not erase provider records or externally stored document files.",
    };
  }

  async remove(id: string, staffId: string, input: { confirmation: string; testDataConfirmed: boolean; reason: string }) {
    if (input.confirmation !== `DELETE ${id}` || input.testDataConfirmed !== true || !input.reason.trim()) {
      throw new BadRequestException("Confirm the exact customer, test-only data and deletion reason.");
    }
    return this.db.transaction(async tx => {
      // FK checks on concurrent child inserts conflict with deletion of this row.
      await tx.select({ id: s.users.id }).from(s.users).where(eq(s.users.id, id)).for("update");
      await tx.select({ id: s.orders.id }).from(s.orders).where(eq(s.orders.userId, id)).orderBy(s.orders.id).for("update");
      await tx.select({ id: s.repaymentSchedules.id }).from(s.repaymentSchedules).where(eq(s.repaymentSchedules.userId, id)).for("update");
      const data = await this.inspect(id, tx);
      if (data.blockers.length) throw new ConflictException(data.blockers.join(" "));
      const summary = this.summary(data);
      const orderIds = data.orders.map(row => row.id);
      const appIds = data.applications.map(row => row.id);
      if (orderIds.length) {
        const entries = await tx.select().from(s.ledgerEntries).where(inArray(s.ledgerEntries.orderId, orderIds));
        const transactions = [...new Set(entries.map(row => row.transactionId))];
        if (transactions.length) {
          const allLegs = await tx.select().from(s.ledgerEntries).where(inArray(s.ledgerEntries.transactionId, transactions));
          if (allLegs.some(row => row.repaymentId !== null || row.orderId === null || !orderIds.includes(row.orderId))) {
            throw new ConflictException("A ledger transaction includes other records. Test reset is unavailable.");
          }
          // Remove complete test journals, never a single leg of a transaction.
          await tx.delete(s.ledgerEntries).where(inArray(s.ledgerEntries.transactionId, transactions));
        }
        for (const order of data.orders) await releaseOrderStock(tx, order, staffId);
        // Stock movements remain immutable, retaining historical order UUIDs.
      }
      if (data.recova.length) await tx.delete(s.recovaCallbacks).where(inArray(s.recovaCallbacks.reference, data.recova.map(row => row.reference)));
      await tx.delete(s.recovaConsents).where(eq(s.recovaConsents.userId, id));
      await tx.delete(s.repaymentSchedules).where(eq(s.repaymentSchedules.userId, id));
      if (orderIds.length) await tx.delete(s.orderItems).where(inArray(s.orderItems.orderId, orderIds));
      await tx.delete(s.orders).where(eq(s.orders.userId, id));
      if (appIds.length) {
        await tx.delete(s.applicationEvents).where(inArray(s.applicationEvents.applicationId, appIds));
        await tx.delete(s.applicationDecisions).where(inArray(s.applicationDecisions.applicationId, appIds));
      }
      await tx.delete(s.applications).where(eq(s.applications.userId, id));
      await tx.delete(s.monoRawResponses).where(eq(s.monoRawResponses.userId, id));
      await tx.delete(s.bankTransactions).where(eq(s.bankTransactions.userId, id));
      await tx.delete(s.financialSummaries).where(eq(s.financialSummaries.userId, id));
      await tx.delete(s.incomeProfiles).where(eq(s.incomeProfiles.userId, id));
      await tx.delete(s.identityVerifications).where(eq(s.identityVerifications.userId, id));
      await tx.delete(s.monoSyncLogs).where(eq(s.monoSyncLogs.userId, id));
      await tx.delete(s.bankAccounts).where(eq(s.bankAccounts.userId, id));
      await tx.delete(s.monoCustomers).where(eq(s.monoCustomers.userId, id));
      await tx.delete(s.kycEvents).where(eq(s.kycEvents.userId, id));
      await tx.delete(s.kycDocuments).where(eq(s.kycDocuments.userId, id));
      await tx.delete(s.applicantProfiles).where(eq(s.applicantProfiles.userId, id));
      await tx.delete(s.creditLimitChanges).where(eq(s.creditLimitChanges.userId, id));
      await tx.delete(s.creditProfiles).where(eq(s.creditProfiles.userId, id));
      await tx.delete(s.consents).where(eq(s.consents.userId, id));
      await tx.delete(s.sessions).where(eq(s.sessions.userId, id));
      await tx.delete(s.phoneVerifications).where(eq(s.phoneVerifications.phone, data.user.phone));
      await tx.delete(s.users).where(eq(s.users.id, id));
      await tx.insert(s.auditLogs).values({ actorStaffId: staffId, action: "customer.test_data_purged", targetType: "user", targetId: id,
        metadata: { reason: input.reason.trim(), ordersRemoved: summary.orders, schedulesRemoved: summary.repaymentSchedules, testDataConfirmed: true } });
      return { id, outcome: "test_data_purged", ordersRemoved: summary.orders };
    });
  }
}
