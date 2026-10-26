import { Body, Controller, Get, Header, Param, ParseUUIDPipe, Post, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { CustomerJwtAuthGuard } from "../../common/guards/customer-jwt-auth.guard";
import { CurrentUser, type AuthenticatedUser } from "../../common/decorators/current-user.decorator";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { prepareConsentSchema, RecovaConsentService } from "./recova-consent.service";

const pinSchema = z.object({ txnPin: z.string().regex(/^\d{4}$/) }).strict();

@ApiTags("recova-repayment-setup")
@ApiBearerAuth()
@Controller("orders/:orderId/recova")
@UseGuards(CustomerJwtAuthGuard)
export class RecovaConsentController {
  constructor(private readonly consent: RecovaConsentService) {}

  @Get()
  @Header("Cache-Control", "no-store")
  status(@CurrentUser() user: AuthenticatedUser, @Param("orderId", new ParseUUIDPipe()) id: string) { return this.consent.status(user.userId, id); }

  @Post("prepare")
  @Header("Cache-Control", "no-store")
  prepare(@CurrentUser() user: AuthenticatedUser, @Param("orderId", new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(prepareConsentSchema)) body: z.infer<typeof prepareConsentSchema>) { return this.consent.prepare(user.userId, id, body); }

  @Post("submit")
  @Header("Cache-Control", "no-store")
  submit(@CurrentUser() user: AuthenticatedUser, @Param("orderId", new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(pinSchema)) body: z.infer<typeof pinSchema>) { return this.consent.submit(user.userId, id, body.txnPin); }

  @Post("refresh")
  @Header("Cache-Control", "no-store")
  refresh(@CurrentUser() user: AuthenticatedUser, @Param("orderId", new ParseUUIDPipe()) id: string) { return this.consent.refresh(user.userId, id); }
}
