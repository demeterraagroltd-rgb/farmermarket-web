import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { ApplicationsController } from "./applications.controller";
import { AdminApplicationsController } from "./admin-applications.controller";
import { ApplicationsService } from "./applications.service";

@Module({
  imports: [AuthModule], // for JwtService, used by JwtAuthGuard
  controllers: [ApplicationsController, AdminApplicationsController],
  providers: [ApplicationsService],
})
export class ApplicationsModule {}
