import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { KycModule } from "../kyc/kyc.module";
import { OrdersModule } from "../orders/orders.module";
import { WalletModule } from "../wallet/wallet.module";
import { CustomersController } from "./customers.controller";
import { CustomersService } from "./customers.service";
import { Customer360Service } from "./customer-360.service";

@Module({
  // The 360 page composes existing services rather than re-querying their
  // tables: KYC/identity/bank, credit + repayments, and orders.
  imports: [AuthModule, KycModule, WalletModule, OrdersModule],
  controllers: [CustomersController],
  providers: [CustomersService, Customer360Service],
})
export class CustomersModule {}
