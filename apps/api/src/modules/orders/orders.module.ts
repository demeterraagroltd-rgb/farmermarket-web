import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { LedgerModule } from "../ledger/ledger.module";
import { OrdersController } from "./orders.controller";
import { AdminOrdersController } from "./admin-orders.controller";
import { OrdersService } from "./orders.service";

@Module({
  imports: [AuthModule, LedgerModule], // AuthModule for JwtService, used by both JWT guards
  controllers: [OrdersController, AdminOrdersController],
  providers: [OrdersService],
})
export class OrdersModule {}
