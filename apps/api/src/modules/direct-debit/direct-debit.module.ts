import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { WalletModule } from "../wallet/wallet.module";
import { DirectDebitService } from "./direct-debit.service";
import {
  AdminDirectDebitController,
  CustomerDirectDebitController,
  DirectDebitCronController,
  DirectDebitWebhookController,
} from "./direct-debit.controller";

// DIRECT_DEBIT_CLIENT comes from the global MonoPaymentsModule and DB from the
// global DbModule. Exports the service so the existing Mono webhook can hand it
// direct-debit events when Mono is pointed at just one URL.
@Module({
  imports: [AuthModule, WalletModule],
  controllers: [
    CustomerDirectDebitController,
    AdminDirectDebitController,
    DirectDebitCronController,
    DirectDebitWebhookController,
  ],
  providers: [DirectDebitService],
  exports: [DirectDebitService],
})
export class DirectDebitModule {}
