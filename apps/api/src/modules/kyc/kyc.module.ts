import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { MonoModule } from "../integrations/mono/mono.module";
import { LookupModule } from "../integrations/mono-lookup/lookup.module";
import { KycService } from "./kyc.service";
import { CustomerRegisterController, KycController } from "./kyc.controller";
import { AdminKycController } from "./admin-kyc.controller";
import { MonoWebhookController } from "./mono-webhook.controller";

@Module({
  // guards + JWT signing; Mono Connect for banking, Mono Lookup for identity
  imports: [AuthModule, MonoModule, LookupModule],
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
