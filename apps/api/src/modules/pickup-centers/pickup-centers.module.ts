import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { AdminPickupCentersController } from "./admin-pickup-centers.controller";
import { PickupCentersController } from "./pickup-centers.controller";
import { PickupCentersService } from "./pickup-centers.service";

@Module({
  imports: [AuthModule], // for JwtService, used by JwtAuthGuard
  controllers: [PickupCentersController, AdminPickupCentersController],
  providers: [PickupCentersService],
  exports: [PickupCentersService],
})
export class PickupCentersModule {}
