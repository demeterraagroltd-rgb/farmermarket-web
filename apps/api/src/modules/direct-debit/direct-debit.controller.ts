import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Inject,
  Logger,
  Param,
  ParseUUIDPipe,
  Post,
  UnauthorizedException,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiExcludeController, ApiTags } from "@nestjs/swagger";
import { timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { koboToNaira } from "@farmermarket/core";
import { webhookEvents, type Db } from "@farmermarket/db";
import { DB } from "../../db/db.module";
import { CustomerJwtAuthGuard } from "../../common/guards/customer-jwt-auth.guard";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { CronSecretGuard } from "../../common/guards/cron-secret.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import { CurrentUser, type AuthenticatedUser } from "../../common/decorators/current-user.decorator";
import { CurrentStaff, type AuthenticatedStaff } from "../../common/decorators/current-staff.decorator";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { DirectDebitService } from "./direct-debit.service";

const pinSchema = z.object({ txnPin: z.string().regex(/^\d{4}$/, "Transaction code must be 4 digits") });
const resolveSchema = z.object({ note: z.string().trim().min(3).max(300) });
const collectSchema = z.object({ dryRun: z.boolean().optional().default(true) }).default({});

type Status = Awaited<ReturnType<DirectDebitService["status"]>>;

/** Kobo in the database and on staff screens; naira on the customer surface, like every other customer endpoint. */
function customerView(s: Status) {
  return {
    available: s.available,
    mandate: s.mandate && {
      status: s.mandate.status,
      limit: koboToNaira(s.mandate.amountKobo),
      collected: koboToNaira(s.mandate.collectedKobo),
      endDate: s.mandate.endDate,
      authorisationUrl: s.mandate.authorisationUrl,
      statusReason: s.mandate.statusReason,
    },
    attempts: s.attempts.map((a) => ({
      id: a.id,
      status: a.status === "needs_review" ? "processing" : a.status, // a review is our business, not the customer's
      amount: koboToNaira(a.amountKobo),
      installmentNumber: a.installmentNumber,
      totalInstallments: a.totalInstallments,
      failureReason: a.status === "failed" ? a.failureReason : null,
      at: a.completedAt ?? a.createdAt,
    })),
  };
}

function staffView(s: Status) {
  return {
    available: s.available,
    mandate: s.mandate && { ...s.mandate, amountKobo: Number(s.mandate.amountKobo), collectedKobo: Number(s.mandate.collectedKobo) },
    attempts: s.attempts.map((a) => ({ ...a, amountKobo: Number(a.amountKobo) })),
  };
}

// ── Customer ────────────────────────────────────────────────────────────

@ApiTags("wallet")
@ApiBearerAuth()
@Controller("wallet/auto-debit")
@UseGuards(CustomerJwtAuthGuard)
export class CustomerDirectDebitController {
  constructor(private readonly dd: DirectDebitService) {}

  @Get()
  async status(@CurrentUser() user: AuthenticatedUser) {
    return customerView(await this.dd.status(user.userId));
  }

  // The consent step: confirmed with the transaction PIN, answered with the
  // Mono link where the customer authorises the mandate at their bank.
  @Post("mandate")
  start(@CurrentUser() user: AuthenticatedUser, @Body(new ZodValidationPipe(pinSchema)) body: { txnPin: string }) {
    return this.dd.startMandate(user.userId, body.txnPin);
  }

  @Delete()
  async cancel(@CurrentUser() user: AuthenticatedUser, @Body(new ZodValidationPipe(pinSchema)) body: { txnPin: string }) {
    await this.dd.authenticate(user.userId, body.txnPin);
    await this.dd.cancel(user.userId);
    return { success: true };
  }
}

// ── Staff ───────────────────────────────────────────────────────────────

@ApiTags("customers")
@ApiBearerAuth()
@Controller("admin")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("super_admin", "admin", "credit")
export class AdminDirectDebitController {
  constructor(private readonly dd: DirectDebitService) {}

  @Get("customers/:id/auto-debit")
  async status(@Param("id", new ParseUUIDPipe()) id: string) {
    return staffView(await this.dd.status(id));
  }

  @Delete("customers/:id/auto-debit")
  @Roles("super_admin", "admin")
  async cancel(@Param("id", new ParseUUIDPipe()) id: string, @CurrentStaff() staff: AuthenticatedStaff) {
    await this.dd.cancel(id, { staffId: staff.staffId });
    return { success: true };
  }

  // A person has dealt with a debit that needed review (e.g. refunded a double
  // collection) — unblocks that installment.
  @Post("auto-debit/attempts/:attemptId/resolve")
  @Roles("super_admin", "admin")
  async resolve(
    @Param("attemptId", new ParseUUIDPipe()) attemptId: string,
    @CurrentStaff() staff: AuthenticatedStaff,
    @Body(new ZodValidationPipe(resolveSchema)) body: { note: string },
  ) {
    await this.dd.resolveReview(attemptId, staff.staffId, body.note);
    return { success: true };
  }

  // Preview by default: shows what a collection pass would debit without
  // sending anything. `{"dryRun": false}` runs a real pass.
  @Post("auto-debit/collect")
  @Roles("super_admin", "admin")
  collect(@Body(new ZodValidationPipe(collectSchema)) body: { dryRun: boolean }) {
    return this.dd.collectDue(new Date(), { dryRun: body.dryRun });
  }
}

// ── Machine-triggered ───────────────────────────────────────────────────

@ApiExcludeController()
@Controller("direct-debit")
export class DirectDebitCronController {
  constructor(private readonly dd: DirectDebitService) {}

  @Post("collect-cron")
  @UseGuards(CronSecretGuard)
  cron() {
    return this.dd.collectDue();
  }
}

// Mono posts direct-debit events here. Same header-secret scheme as the Connect
// webhook; its own secret if you set one, otherwise the shared one.
@ApiExcludeController()
@Controller("webhooks/mono-payments")
export class DirectDebitWebhookController {
  private readonly log = new Logger("DirectDebitWebhook");

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly dd: DirectDebitService,
  ) {}

  @Post()
  @HttpCode(200)
  async handle(
    @Headers("mono-webhook-secret") secret: string | undefined,
    @Body() body: { event?: string; event_id?: string; timestamp?: string; data?: Record<string, unknown> },
  ) {
    const expected = process.env.MONO_PAYMENTS_WEBHOOK_SECRET || process.env.MONO_WEBHOOK_SECRET;
    if (!expected) {
      this.log.error("No webhook secret configured — rejecting webhook");
      throw new UnauthorizedException();
    }
    if (typeof secret !== "string" || secret.length !== expected.length || !timingSafeEqual(Buffer.from(secret), Buffer.from(expected))) {
      throw new UnauthorizedException("Bad webhook secret");
    }

    const event = body?.event ?? "unknown";
    const eventId = `mono-payments:${body?.event_id ?? `${event}:${body?.timestamp ?? "?"}:${JSON.stringify(body?.data ?? {}).slice(0, 80)}`}`;
    try {
      await this.db.insert(webhookEvents).values({ source: "mono-payments", eventId, payload: body as unknown as Record<string, unknown> });
    } catch (e) {
      const code = (e as { code?: string; cause?: { code?: string } })?.code ?? (e as { cause?: { code?: string } })?.cause?.code;
      if (code === "23505") return { ok: true, duplicate: true };
      throw e; // a real database error must not be mistaken for a duplicate and swallowed
    }

    try {
      const result = await this.dd.processEvent(event, body?.data);
      await this.db.update(webhookEvents).set({ processedAt: new Date() }).where(eq(webhookEvents.eventId, eventId));
      return { ok: true, result };
    } catch (e) {
      // Un-record it and answer 500 so Mono redelivers: a lost debit
      // confirmation is money we'd never book.
      await this.db.delete(webhookEvents).where(eq(webhookEvents.eventId, eventId));
      throw e;
    }
  }
}
