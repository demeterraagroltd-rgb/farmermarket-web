import { Global, Module } from "@nestjs/common";
import { EmailService } from "./email.service";

// Global so KycService / OrdersService can inject EmailService without every
// module wiring an import.
@Global()
@Module({
  providers: [EmailService],
  exports: [EmailService],
})
export class NotificationsModule {}
