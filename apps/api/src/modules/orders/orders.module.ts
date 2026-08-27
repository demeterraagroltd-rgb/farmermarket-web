import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { LedgerModule } from "../ledger/ledger.module";
import { OrdersController } from "./orders.controller";
import { OrdersService } from "./orders.service";

@Module({
  imports: [AuthModule, LedgerModule], // AuthModule for JwtService, used by CustomerJwtAuthGuard
  controllers: [OrdersController],
  providers: [OrdersService],
})
export class OrdersModule {}
