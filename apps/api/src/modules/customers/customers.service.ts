import { ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { and, count, desc, eq, inArray, isNull } from "drizzle-orm";
import {
  users,
  creditProfiles,
  creditLimitChanges,
  consents,
  sessions,
  orders,
  applicantProfiles,
  kycDocuments,
  kycEvents,
  applications,
  applicationEvents,
  applicationDecisions,
  auditLogs,
  type Db,
} from "@farmermarket/db";
import { DB } from "../../db/db.module";

@Injectable()
export class CustomersService {
  constructor(@Inject(DB) private readonly db: Db) {}

  // The 360° view (§11.4) is much bigger than this — profile, order
  // history, repayment behaviour, all applications, notes. This is just
  // "who has an account, and what's their credit limit right now."
  async findAll() {
    return this.db
      .select({
        id: users.id,
        phone: users.phone,
        fullName: users.fullName,
        email: users.email,
        createdAt: users.createdAt,
        deactivatedAt: users.deactivatedAt,
        deactivatedReason: users.deactivatedReason,
        creditLimitKobo: creditProfiles.creditLimitKobo,
        usedCreditKobo: creditProfiles.usedCreditKobo,
        tier: creditProfiles.tier,
        isVerified: creditProfiles.isVerified,
      })
      .from(users)
      .leftJoin(creditProfiles, eq(creditProfiles.userId, users.id))
      .orderBy(desc(users.createdAt));
  }

  /**
   * Admin removal of a customer (§6.2 — super_admin/admin only). Hybrid
   * policy:
   *  - An account that has never ordered and has no credit profile leaves
   *    no financial or underwriting trail, so it is hard-purged — GDPR-style
   *    erasure of a prospect or rejected applicant.
   *  - Anything else is soft-deleted: the row and all its order / ledger /
   *    KYC history stay, but the account can no longer log in and any live
   *    token is rejected on its next request (CustomerJwtAuthGuard), and any
   *    session row is revoked here so a refresh can't resurrect it.
   * Re-deleting an already-deactivated account is a 409 — use `reactivate`.
   */
  async remove(id: string, staffId: string, reason?: string) {
    const [user] = await this.db.select().from(users).where(eq(users.id, id)).limit(1);
    if (!user) throw new NotFoundException("Customer not found");
    if (user.deactivatedAt) {
      throw new ConflictException("This account is already deactivated");
    }

    const [{ n: orderCount }] = await this.db
      .select({ n: count() })
      .from(orders)
      .where(eq(orders.userId, id));
    const [creditProfile] = await this.db
      .select({ userId: creditProfiles.userId })
      .from(creditProfiles)
      .where(eq(creditProfiles.userId, id))
      .limit(1);

    if (orderCount === 0 && !creditProfile) {
      await this.purge(id, staffId, reason);
      return { id, outcome: "purged" as const };
    }

    await this.db.transaction(async (tx) => {
      await tx
        .update(users)
        .set({
          deactivatedAt: new Date(),
          deactivatedReason: reason ?? null,
          deactivatedByStaffId: staffId,
          updatedAt: new Date(),
        })
        .where(eq(users.id, id));
      await tx
        .update(sessions)
        .set({ revokedAt: new Date() })
        .where(and(eq(sessions.userId, id), isNull(sessions.revokedAt)));
      await tx.insert(auditLogs).values({
        actorStaffId: staffId,
        action: "customer.deactivated",
        targetType: "user",
        targetId: id,
        metadata: reason ? { reason } : undefined,
      });
    });
    return { id, outcome: "deactivated" as const };
  }

  // Every FK to users.id is ON DELETE NO ACTION, so children come out first,
  // deepest first, all in one transaction. Only reachable for accounts with
  // no orders and no credit profile, so orders / repayment_schedules /
  // repayments / ledger_entries are all necessarily empty and skipped.
  private async purge(id: string, staffId: string, reason?: string) {
    await this.db.transaction(async (tx) => {
      const appRows = await tx
        .select({ id: applications.id })
        .from(applications)
        .where(eq(applications.userId, id));
      const appIds = appRows.map((a) => a.id);
      if (appIds.length > 0) {
        await tx.delete(applicationEvents).where(inArray(applicationEvents.applicationId, appIds));
        await tx.delete(applicationDecisions).where(inArray(applicationDecisions.applicationId, appIds));
        await tx.delete(applications).where(eq(applications.userId, id));
      }
      await tx.delete(kycEvents).where(eq(kycEvents.userId, id));
      await tx.delete(kycDocuments).where(eq(kycDocuments.userId, id));
      await tx.delete(applicantProfiles).where(eq(applicantProfiles.userId, id));
      await tx.delete(creditLimitChanges).where(eq(creditLimitChanges.userId, id));
      await tx.delete(consents).where(eq(consents.userId, id));
      await tx.delete(sessions).where(eq(sessions.userId, id));
      await tx.delete(users).where(eq(users.id, id));
      await tx.insert(auditLogs).values({
        actorStaffId: staffId,
        action: "customer.purged",
        targetType: "user",
        targetId: id,
        metadata: reason ? { reason } : undefined,
      });
    });
  }

  /** Lift a soft delete. Purged accounts are gone for good — this is 404. */
  async reactivate(id: string, staffId: string) {
    const [user] = await this.db.select().from(users).where(eq(users.id, id)).limit(1);
    if (!user) throw new NotFoundException("Customer not found");
    if (!user.deactivatedAt) {
      throw new ConflictException("This account is already active");
    }
    await this.db.transaction(async (tx) => {
      await tx
        .update(users)
        .set({
          deactivatedAt: null,
          deactivatedReason: null,
          deactivatedByStaffId: null,
          updatedAt: new Date(),
        })
        .where(eq(users.id, id));
      await tx.insert(auditLogs).values({
        actorStaffId: staffId,
        action: "customer.reactivated",
        targetType: "user",
        targetId: id,
      });
    });
    return { id, outcome: "reactivated" as const };
  }
}
