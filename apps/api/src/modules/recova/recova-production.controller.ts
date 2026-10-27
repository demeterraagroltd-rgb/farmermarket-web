import { Controller, Get, Header, Inject, Param, UseGuards } from "@nestjs/common";
import { desc, eq } from "drizzle-orm";
import { orders, recovaConsents, users, type Db } from "@farmermarket/db";
import { DB } from "../../db/db.module";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { productionStatus } from "./recova-production.config";
import { requestProductionLookup } from "./recova.client";
import { consentSetupStatus } from "./recova-consent.config";
import { recovaReadiness } from "./recova-readiness";

const reference = z.string().min(1).max(100).regex(/^[A-Za-z0-9._-]+$/, "Use a valid Recova loan reference.");

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
}
