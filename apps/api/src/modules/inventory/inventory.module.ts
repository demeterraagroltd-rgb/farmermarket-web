import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { AdminInventoryController } from "./admin-inventory.controller";
import { InventoryCronController } from "./inventory-cron.controller";
import { InventoryService } from "./inventory.service";

@Module({
  imports: [AuthModule], // for JwtService, used by JwtAuthGuard
  controllers: [AdminInventoryController, InventoryCronController],
  providers: [InventoryService],
  // OrdersService reserves / dispatches / releases through this.
  exports: [InventoryService],
})
export class InventoryModule {}
