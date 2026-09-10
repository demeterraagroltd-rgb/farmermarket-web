import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { MonoModule } from "../integrations/mono/mono.module";
import { KycService } from "./kyc.service";
import { CustomerRegisterController, KycController } from "./kyc.controller";
import { AdminKycController } from "./admin-kyc.controller";
import { MonoWebhookController } from "./mono-webhook.controller";

@Module({
  imports: [AuthModule, MonoModule], // guards + JWT signing; Mono for bank linking
  controllers: [
    CustomerRegisterController,
    KycController,
    AdminKycController,
    MonoWebhookController,
  ],
  providers: [KycService],
  exports: [KycService], // OrdersService uses assertVerified / getVerificationStatus
})
export class KycModule {}
