import { Body, ConflictException, Controller, Get, Inject, Param, Post, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { and, eq, sql } from "drizzle-orm";
import { auditLogs, type Db } from "@farmermarket/db";
import { z } from "zod";
import { DB } from "../../db/db.module";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import { CurrentStaff, type AuthenticatedStaff } from "../../common/decorators/current-staff.decorator";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { assertSandboxEnabled, RECOVA_STAGING, requestSandbox } from "./recova.client";
import { consentPayload, consentSchema, previewRepayment, previewSchema } from "./recova-policy";
import { RecovaJourneyService } from "./recova-journey.service";

const refSchema = z.string().regex(/^fm-sandbox-[A-Za-z0-9-]{6,80}$/);

@ApiTags("recova-sandbox")
@ApiBearerAuth()
@Controller("admin/recova/sandbox")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("super_admin", "admin")
export class RecovaSandboxController {
  constructor(@Inject(DB) private readonly db: Db, @Inject(RecovaJourneyService) private readonly journey: RecovaJourneyService) {}

  @Get("journey")
  getJourney(@CurrentStaff() staff: AuthenticatedStaff) { return this.journey.status(staff.staffId); }

  @Post("journey/start")
  startJourney(@CurrentStaff() staff: AuthenticatedStaff) { return this.journey.start(staff.staffId); }

  @Post("journey/next")
  nextJourney(@CurrentStaff() staff: AuthenticatedStaff) { return this.journey.advance(staff.staffId); }

  @Post("journey/run")
  runJourney(@CurrentStaff() staff: AuthenticatedStaff) { return this.journey.advance(staff.staffId, true); }

  @Get("status")
  status() {
    return {
      enabled: process.env.RECOVA_SANDBOX_ENABLED === "true",
      tokenConfigured: !!process.env.RECOVA_API_TOKEN?.trim(),
      destination: RECOVA_STAGING, liveDebitsEnabled: false,
      policy: "Collect due installments and arrears during the tenor; preview recovery after the final due date ends in Nigeria. Additional interest is zero.",
    };
  }

  @Post("preview")
  preview(@Body(new ZodValidationPipe(previewSchema)) input: z.infer<typeof previewSchema>) {
    return previewRepayment(input);
  }

  @Get("consent/:reference")
  consent(@Param("reference", new ZodValidationPipe(refSchema)) reference: string) {
    return requestSandbox("consent", reference);
  }

  @Get("mandate/:reference")
  mandate(@Param("reference", new ZodValidationPipe(refSchema)) reference: string) {
    return requestSandbox("mandate", reference);
  }

  /** Re-sends the approval message for a pending or expired consent. */
  @Post("consent/:reference/resend")
  async resend(@Param("reference", new ZodValidationPipe(refSchema)) reference: string, @CurrentStaff() staff: AuthenticatedStaff) {
    return this.audited("recova.sandbox.consent_resent", reference, staff, () => requestSandbox("resend-consent", reference));
  }

  /** Cancels a test mandate so staging stops scheduling debits against the test account. */
  @Post("mandate/:reference/cancel")
  async cancel(@Param("reference", new ZodValidationPipe(refSchema)) reference: string, @CurrentStaff() staff: AuthenticatedStaff) {
    return this.audited("recova.sandbox.mandate_cancelled", reference, staff, () => requestSandbox("cancel-mandate", reference));
  }

  private async audited(action: string, reference: string, staff: AuthenticatedStaff, send: () => ReturnType<typeof requestSandbox>) {
    assertSandboxEnabled();
    const [entry] = await this.db.insert(auditLogs).values({
      actorStaffId: staff.staffId, action, targetType: "recova_sandbox", targetId: reference,
      metadata: { environment: "staging", outcome: "unconfirmed" },
    }).returning({ id: auditLogs.id });
    const result = await send();
    await this.db.update(auditLogs).set({ metadata: { environment: "staging", httpStatus: result.httpStatus } }).where(eq(auditLogs.id, entry.id));
    return result;
  }

  @Post("consent")
  async create(@Body(new ZodValidationPipe(consentSchema)) input: z.infer<typeof consentSchema>, @CurrentStaff() staff: AuthenticatedStaff) {
    assertSandboxEnabled();
    const payload = consentPayload(input);
    // Serialize attempts for this reference across API replicas. The durable
    // intent survives an ambiguous timeout; repeated POSTs must use lookup.
    const auditId = await this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`recova-sandbox:${input.loanReference}`}))`);
      const [existing] = await tx.select({ id: auditLogs.id }).from(auditLogs).where(and(
        eq(auditLogs.action, "recova.sandbox.consent_submitted"), eq(auditLogs.targetId, input.loanReference),
      )).limit(1);
      if (existing) throw new ConflictException("This test reference was already submitted. Retrieve its consent/mandate status; do not resubmit it.");
      const [entry] = await tx.insert(auditLogs).values({
        actorStaffId: staff.staffId, action: "recova.sandbox.consent_submitted", targetType: "recova_sandbox",
        targetId: input.loanReference, metadata: { environment: "staging", repaymentType: input.repaymentType, outcome: "unconfirmed" },
      }).returning({ id: auditLogs.id });
      return entry.id;
    });
    const result = await requestSandbox("create-consent", input.loanReference, payload);
    await this.db.update(auditLogs).set({ metadata: { environment: "staging", repaymentType: input.repaymentType, httpStatus: result.httpStatus } }).where(eq(auditLogs.id, auditId));
    return result;
  }
}
