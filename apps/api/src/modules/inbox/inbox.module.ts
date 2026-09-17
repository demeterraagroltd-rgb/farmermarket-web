import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { MailModule } from "../integrations/mail/mail.module";
import { InboxController, InboxCronController } from "./inbox.controller";
import { InboxService } from "./inbox.service";

@Module({
  imports: [AuthModule, MailModule], // JwtService for JwtAuthGuard
  controllers: [InboxController, InboxCronController],
  providers: [InboxService],
})
export class InboxModule {}
