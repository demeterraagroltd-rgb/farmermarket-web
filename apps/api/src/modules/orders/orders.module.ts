import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { LedgerModule } from "../ledger/ledger.module";
import { KycModule } from "../kyc/kyc.module";
import { OrdersController } from "./orders.controller";
import { AdminOrdersController } from "./admin-orders.controller";
import { OrdersService } from "./orders.service";

@Module({
  imports: [AuthModule, LedgerModule, KycModule], // AuthModule: JwtService for guards; KycModule: verified gate
  controllers: [OrdersController, AdminOrdersController],
  providers: [OrdersService],
})
export class OrdersModule {}
