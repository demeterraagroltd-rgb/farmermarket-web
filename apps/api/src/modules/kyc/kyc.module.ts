import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { KycService } from "./kyc.service";
import { CustomerRegisterController, KycController } from "./kyc.controller";
import { AdminKycController } from "./admin-kyc.controller";

@Module({
  imports: [AuthModule], // JwtService (both guards) + JWT signing for register
  controllers: [CustomerRegisterController, KycController, AdminKycController],
  providers: [KycService],
  exports: [KycService], // OrdersService uses assertVerified / getVerificationStatus
})
export class KycModule {}
