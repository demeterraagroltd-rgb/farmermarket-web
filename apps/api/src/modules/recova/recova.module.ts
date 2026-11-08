import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { RecovaSandboxController } from "./recova.controller";
import { RecovaJourneyService } from "./recova-journey.service";
import { RecovaProductionController } from "./recova-production.controller";
import { RecovaConsentController } from "./recova-consent.controller";
import { RecovaConsentService } from "./recova-consent.service";
import { RecovaWebhookController } from "./recova-webhook.controller";
import { RecovaReconciliationController } from "./recova-reconciliation.controller";
import { RecovaReconciliationService } from "./recova-reconciliation.service";

@Module({ imports: [AuthModule], controllers: [RecovaSandboxController, RecovaProductionController, RecovaConsentController, RecovaWebhookController, RecovaReconciliationController], providers: [RecovaJourneyService, RecovaConsentService, RecovaReconciliationService] })
export class RecovaModule {}
