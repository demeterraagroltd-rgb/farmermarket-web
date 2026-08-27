import { Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { CustomerJwtAuthGuard } from "../../common/guards/customer-jwt-auth.guard";
import { CurrentUser, type AuthenticatedUser } from "../../common/decorators/current-user.decorator";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { WalletService } from "./wallet.service";
import { PayRepaymentDto, payRepaymentSchema } from "./dto/pay-repayment.dto";

// Matches WalletRepository's sketched routes exactly (§14):
// GET /credit/profile, GET /wallet/transactions, GET /wallet/repayments,
// POST /wallet/repayments/:id/pay.
@ApiTags("wallet")
@ApiBearerAuth()
@Controller()
@UseGuards(CustomerJwtAuthGuard)
export class WalletController {
  constructor(private readonly walletService: WalletService) {}

  @Get("credit/profile")
  getCreditProfile(@CurrentUser() user: AuthenticatedUser) {
    return this.walletService.getCreditProfile(user.userId);
  }

  @Get("wallet/transactions")
  getTransactions(@CurrentUser() user: AuthenticatedUser) {
    return this.walletService.getTransactions(user.userId);
  }

  @Get("wallet/repayments")
  getRepaymentSchedules(@CurrentUser() user: AuthenticatedUser) {
    return this.walletService.getRepaymentSchedules(user.userId);
  }

  @Post("wallet/repayments/:id/pay")
  payRepayment(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(payRepaymentSchema)) body: PayRepaymentDto,
  ) {
    return this.walletService.payRepayment(user.userId, id, body);
  }
}
