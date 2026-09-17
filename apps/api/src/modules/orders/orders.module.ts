import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { LedgerModule } from "../ledger/ledger.module";
import { KycModule } from "../kyc/kyc.module";
import { WalletModule } from "../wallet/wallet.module";
import { OrdersController } from "./orders.controller";
import { AdminOrdersController } from "./admin-orders.controller";
import { OrdersService } from "./orders.service";
import { OrderReviewService } from "./order-review.service";

@Module({
  // AuthModule: JwtService for guards; KycModule: verified gate + applicant
  // data; WalletModule: credit position — both for the Order Review workspace.
  imports: [AuthModule, LedgerModule, KycModule, WalletModule],
  controllers: [OrdersController, AdminOrdersController],
  providers: [OrdersService, OrderReviewService],
})
export class OrdersModule {}
