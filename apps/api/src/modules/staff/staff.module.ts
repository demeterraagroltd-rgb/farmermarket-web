import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { StaffController } from "./staff.controller";
import { StaffService } from "./staff.service";

@Module({
  imports: [AuthModule], // for JwtService, used by JwtAuthGuard
  controllers: [StaffController],
  providers: [StaffService],
})
export class StaffModule {}
