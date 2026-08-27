import { Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { WalletService } from "./wallet.service";
import { PayRepaymentDto, payRepaymentSchema } from "./dto/pay-repayment.dto";

// Collections view (§12 "Collections" report / §11.4 repayments section) —
// every repayment schedule across all customers, aged, plus the ability to
// record a payment received off-platform.
@ApiTags("wallet")
@ApiBearerAuth()
@Controller("admin/repayments")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("super_admin", "admin", "credit")
export class AdminRepaymentsController {
  constructor(private readonly walletService: WalletService) {}

  @Get()
  listAll() {
    return this.walletService.listAllRepayments();
  }

  @Post(":id/record")
  @Roles("super_admin", "admin", "credit")
  record(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(payRepaymentSchema)) body: PayRepaymentDto,
  ) {
    return this.walletService.recordRepayment(id, body.amountNaira);
  }
}
