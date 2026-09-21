import { ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { and, count, desc, eq, inArray, isNull, sql } from "drizzle-orm";
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
import type { IdentityCheck } from "../kyc/identity-match";
import {
  bankConnectionState,
  employmentState,
  freshnessOf,
  identityStatuses,
  lastFinancialSync,
} from "./customer-360";

@Injectable()
export class CustomersService {
  constructor(@Inject(DB) private readonly db: Db) {}

  // One row per customer with the statuses an admin scans for: KYC, BVN/NIN
  // verification, bank connection, employment, last financial sync. Every
  // status is derived (customer-360.ts) from data already on the row — the list
  // never calls Mono — and the heavy JSON (bank analysis, identity check) is
  // reduced to those statuses here rather than shipped to the browser. The full
  // picture for one customer is Customer360Service.getDetail.
  async findAll() {
    const rows = await this.db
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
        verificationStatus: applicantProfiles.verificationStatus,
        hasBvn: sql<boolean>`${applicantProfiles.bvnHash} IS NOT NULL`,
        hasNin: sql<boolean>`${applicantProfiles.nin} IS NOT NULL`,
        identityLookup: applicantProfiles.identityLookup,
        monoAccountId: applicantProfiles.monoAccountId,
        bankLinkRequestedAt: applicantProfiles.bankLinkRequestedAt,
        bankLinkedAt: applicantProfiles.bankLinkedAt,
        bankAnalysis: applicantProfiles.bankAnalysis,
        employmentType: applicantProfiles.employmentType,
        employer: applicantProfiles.employer,
        jobTitle: applicantProfiles.jobTitle,
        netMonthlySalaryKobo: applicantProfiles.netMonthlySalaryKobo,
      })
      .from(users)
      .leftJoin(creditProfiles, eq(creditProfiles.userId, users.id))
      .leftJoin(applicantProfiles, eq(applicantProfiles.userId, users.id))
      .orderBy(desc(users.createdAt));

    const now = new Date();
    return rows.map((r) => {
      const analysis = (r.bankAnalysis ?? null) as { pulledAt?: string } | null;
      const identity = identityStatuses({
        hasBvn: !!r.hasBvn,
        hasNin: !!r.hasNin,
        identityLookup: (r.identityLookup ?? null) as IdentityCheck | null,
      });
      const lastSyncAt = lastFinancialSync({ bankAnalysis: analysis, bankLinkedAt: r.bankLinkedAt });
      return {
        id: r.id,
        phone: r.phone,
        fullName: r.fullName,
        email: r.email,
        createdAt: r.createdAt,
        deactivatedAt: r.deactivatedAt,
        deactivatedReason: r.deactivatedReason,
        accountStatus: r.deactivatedAt ? ("suspended" as const) : ("active" as const),
        creditLimitKobo: r.creditLimitKobo,
        usedCreditKobo: r.usedCreditKobo,
        tier: r.tier,
        isVerified: r.isVerified,
        // null for a customer with no KYC profile at all (an older account).
        kycStatus: r.verificationStatus ?? null,
        bvnStatus: identity.bvn.state,
        ninStatus: identity.nin.state,
        bankState: bankConnectionState({
          monoAccountId: r.monoAccountId,
          bankLinkRequestedAt: r.bankLinkRequestedAt,
        }),
        employmentState: employmentState({
          employmentType: r.employmentType,
          employer: r.employer,
          jobTitle: r.jobTitle,
          netMonthlySalaryKobo: r.netMonthlySalaryKobo,
        }),
        lastFinancialSyncAt: lastSyncAt,
        freshness: freshnessOf(lastSyncAt, now).state,
      };
    });
  }

  /**
   * Bar a customer from signing in without deleting anything. Unlike
   * {@link remove} this never purges: a prospect with no orders is suspended,
   * not erased, so "Suspend" is always reversible with "Activate".
   */
  async suspend(id: string, staffId: string, reason?: string) {
    const [user] = await this.db.select().from(users).where(eq(users.id, id)).limit(1);
    if (!user) throw new NotFoundException("Customer not found");
    if (user.deactivatedAt) throw new ConflictException("This account is already suspended");
    await this.deactivate(id, staffId, reason, "customer.suspended");
    return { id, outcome: "suspended" as const };
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

    await this.deactivate(id, staffId, reason, "customer.deactivated");
    return { id, outcome: "deactivated" as const };
  }

  // Shared by remove() (a customer with history) and suspend(): stop the
  // account signing in and kill any live session, in one transaction, with the
  // audit row naming which of the two the admin actually asked for.
  private async deactivate(
    id: string,
    staffId: string,
    reason: string | undefined,
    action: "customer.deactivated" | "customer.suspended",
  ) {
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
        action,
        targetType: "user",
        targetId: id,
        metadata: reason ? { reason } : undefined,
      });
    });
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
