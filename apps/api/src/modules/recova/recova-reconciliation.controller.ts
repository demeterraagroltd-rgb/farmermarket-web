import { Body, Controller, Get, Header, Inject, Param, ParseUUIDPipe, Post, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import { CurrentStaff, type AuthenticatedStaff } from "../../common/decorators/current-staff.decorator";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { z } from "zod";
import { RecovaReconciliationService, paymentReportSchema, dismissReportSchema } from "./recova-reconciliation.service";

const reference = z.string().regex(/^fm-live-[a-f0-9-]{36}$/);
@Controller("admin/recova/reconciliation")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("super_admin", "admin")
export class RecovaReconciliationController {
  constructor(@Inject(RecovaReconciliationService) private readonly service: RecovaReconciliationService) {}
  @Get()
  @Header("Cache-Control", "no-store")
  overview() { return this.service.overview(); }
  @Get(":reference")
  @Header("Cache-Control", "no-store")
  detail(@Param("reference", new ZodValidationPipe(reference)) ref: string) { return this.service.detail(ref); }
  @Post(":reference/reports")
  report(@Param("reference", new ZodValidationPipe(reference)) ref: string, @CurrentStaff() staff: AuthenticatedStaff,
    @Body(new ZodValidationPipe(paymentReportSchema)) body: z.infer<typeof paymentReportSchema>) {
    return this.service.report(ref, staff.staffId, body);
  }
  @Post("reports/:id/dismiss")
  dismiss(@Param("id", new ParseUUIDPipe()) id: string, @CurrentStaff() staff: AuthenticatedStaff,
    @Body(new ZodValidationPipe(dismissReportSchema)) body: z.infer<typeof dismissReportSchema>) {
    return this.service.dismiss(id, staff.staffId, body.reason);
  }
}
