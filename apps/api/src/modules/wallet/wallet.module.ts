import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { LedgerModule } from "../ledger/ledger.module";
import { WalletController } from "./wallet.controller";
import { WalletService } from "./wallet.service";

@Module({
  imports: [AuthModule, LedgerModule],
  controllers: [WalletController],
  providers: [WalletService],
})
export class WalletModule {}
