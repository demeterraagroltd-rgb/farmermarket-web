import { Body, Controller, Get, Param, ParseUUIDPipe, Post, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import { CurrentStaff, type AuthenticatedStaff } from "../../common/decorators/current-staff.decorator";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { PayablesService } from "./payables.service";
import { invoiceSchema, invoiceActionSchema, paymentSchema, reversePaymentSchema, creditSchema, creditActionSchema, type InvoiceInput, type InvoiceAction, type PaymentInput, type CreditInput, type CreditAction } from "./payables.dto";

@Controller("admin/purchasing/payables")
@ApiTags("supplier-payables") @ApiBearerAuth() @UseGuards(JwtAuthGuard,RolesGuard) @Roles("admin","super_admin")
export class PayablesController {
  constructor(private readonly service:PayablesService) {}
  @Get() overview() {return this.service.overview();}
  @Get("matching/:id") match(@Param("id",ParseUUIDPipe) id:string) {return this.service.match(id);}
  @Post("invoices") create(@Body(new ZodValidationPipe(invoiceSchema)) input:InvoiceInput,@CurrentStaff() actor:AuthenticatedStaff) {return this.service.create(input,actor);}
  @Get("invoices/:id") detail(@Param("id",ParseUUIDPipe) id:string) {return this.service.detail(id);}
  @Post("invoices/:id/actions") action(@Param("id",ParseUUIDPipe) id:string,@Body(new ZodValidationPipe(invoiceActionSchema)) input:InvoiceAction,@CurrentStaff() actor:AuthenticatedStaff) {return this.service.action(id,input,actor);}
  @Post("invoices/:id/payments") pay(@Param("id",ParseUUIDPipe) id:string,@Body(new ZodValidationPipe(paymentSchema)) input:PaymentInput,@CurrentStaff() actor:AuthenticatedStaff) {return this.service.pay(id,input,actor);}
  @Post("payments/:id/reversal") reverse(@Param("id",ParseUUIDPipe) id:string,@Body(new ZodValidationPipe(reversePaymentSchema)) input:{reason:string},@CurrentStaff() actor:AuthenticatedStaff) {return this.service.reverse(id,input.reason,actor);}
  @Post("invoices/:id/credits") credit(@Param("id",ParseUUIDPipe) id:string,@Body(new ZodValidationPipe(creditSchema)) input:CreditInput,@CurrentStaff() actor:AuthenticatedStaff) {return this.service.createCredit(id,input,actor);}
  @Post("credits/:id/actions") creditAction(@Param("id",ParseUUIDPipe) id:string,@Body(new ZodValidationPipe(creditActionSchema)) input:CreditAction,@CurrentStaff() actor:AuthenticatedStaff) {return this.service.creditAction(id,input,actor);}
}
