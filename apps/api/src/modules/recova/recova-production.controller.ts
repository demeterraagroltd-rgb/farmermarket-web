import { ConflictException, Controller, Get, Header, Inject, NotFoundException, Param, Post, UseGuards } from "@nestjs/common";
import { and, desc, eq, gt, sql } from "drizzle-orm";
import { auditLogs, orders, recovaConsents, users, type Db } from "@farmermarket/db";
import { DB } from "../../db/db.module";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { CurrentStaff, type AuthenticatedStaff } from "../../common/decorators/current-staff.decorator";
import { productionStatus } from "./recova-production.config";
import { requestProductionConsentResend, requestProductionLookup } from "./recova.client";
import { consentSetupStatus } from "./recova-consent.config";
import { recovaReadiness } from "./recova-readiness";

const reference = z.string().min(1).max(100).regex(/^[A-Za-z0-9._-]+$/, "Use a valid Recova loan reference.");
const liveReference = z.string().regex(/^fm-live-[a-f0-9-]{36}$/, "Use a Farmer Market loan reference.");
/** Only consents still waiting on the customer's token can be re-sent. */
const RESENDABLE = new Set(["awaiting_consent", "needs_review", "expired"]);
const RESEND_COOLDOWN_MS = 2 * 60 * 1000;
const RESEND_ACTION = "recova.production.consent_resent";

@ApiTags("recova-production")
@ApiBearerAuth()
@Controller("admin/recova/production")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("super_admin", "admin")
export class RecovaProductionController {
  constructor(@Inject(DB) private readonly db: Db) {}

  /** Every customer repayment setup we've recorded, newest first. No BVNs, full accounts or links. */
  @Get("consents")
  @Header("Cache-Control", "no-store")
  async consents() {
    const rows = await this.db.select({
      reference: recovaConsents.reference, status: recovaConsents.status, purpose: recovaConsents.purpose,
      bankCode: recovaConsents.bankCode, accountLast4: recovaConsents.accountLast4,
      submittedAt: recovaConsents.submittedAt, checkedAt: recovaConsents.checkedAt, createdAt: recovaConsents.createdAt,
      orderId: recovaConsents.orderId, totalKobo: orders.totalKobo, customerName: users.fullName,
    }).from(recovaConsents)
      .innerJoin(orders, eq(orders.id, recovaConsents.orderId))
      .innerJoin(users, eq(users.id, recovaConsents.userId))
      .orderBy(desc(recovaConsents.createdAt)).limit(200);
    return rows.map(({ totalKobo, ...r }) => ({ ...r, total: Number(totalKobo) / 100 }));
  }

  @Get("status")
  @Header("Cache-Control", "no-store")
  status() { return { ...productionStatus(), customerSetup: consentSetupStatus(), readiness: recovaReadiness() }; }

  @Get("mandate/:reference")
  @Header("Cache-Control", "no-store")
  mandate(@Param("reference", new ZodValidationPipe(reference)) ref: string) { return requestProductionLookup("mandate", ref); }

  @Get("consent/:reference")
  @Header("Cache-Control", "no-store")
  consent(@Param("reference", new ZodValidationPipe(reference)) ref: string) { return requestProductionLookup("consent", ref); }

  /** Asks Recova to text the customer's approval token again. Rate limited per
   * reference so repeated clicks cannot flood the customer with SMS. */
  @Post("consent/:reference/resend")
  async resend(@Param("reference", new ZodValidationPipe(liveReference)) ref: string, @CurrentStaff() staff: AuthenticatedStaff) {
    const auditId = await this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`recova-resend:${ref}`}))`);
      const [row] = await tx.select({ status: recovaConsents.status }).from(recovaConsents).where(eq(recovaConsents.reference, ref)).limit(1);
      if (!row) throw new NotFoundException("No customer repayment setup has this reference.");
      if (!RESENDABLE.has(row.status)) throw new ConflictException("Only setups still waiting for the customer's token can be re-sent.");
      const [recent] = await tx.select({ id: auditLogs.id }).from(auditLogs).where(and(
        eq(auditLogs.action, RESEND_ACTION), eq(auditLogs.targetId, ref),
        gt(auditLogs.createdAt, new Date(Date.now() - RESEND_COOLDOWN_MS)),
      )).limit(1);
      if (recent) throw new ConflictException("The token was re-sent less than 2 minutes ago. Give it a moment to arrive before trying again.");
      const [entry] = await tx.insert(auditLogs).values({
        actorStaffId: staff.staffId, action: RESEND_ACTION, targetType: "recova_consent", targetId: ref,
        metadata: { environment: "production", outcome: "unconfirmed" },
      }).returning({ id: auditLogs.id });
      return entry.id;
    });
    const result = await requestProductionConsentResend(ref);
    await this.db.update(auditLogs).set({ metadata: { environment: "production", httpStatus: result.httpStatus } }).where(eq(auditLogs.id, auditId));
    return result;
  }
}
