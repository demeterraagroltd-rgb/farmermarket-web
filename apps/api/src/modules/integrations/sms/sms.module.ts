import { Global, Logger, Module } from "@nestjs/common";
import { SMS_SENDER } from "./sms.types";
import { TermiiSmsSender } from "./termii.sms";
import { FakeSmsSender } from "./fake.sms";

// Global so OtpService (and later arrears reminders) can inject SMS_SENDER
// without every module re-importing this. Picks the real Termii sender only
// when a key is present — otherwise the fake, exactly like NotificationsModule.
@Global()
@Module({
  providers: [
    {
      provide: SMS_SENDER,
      useFactory: () => {
        const apiKey = process.env.TERMII_API_KEY;
        if (!apiKey) {
          new Logger("SmsModule").warn(
            "TERMII_API_KEY not set — SMS runs in dry-run mode (codes are logged, not sent).",
          );
          return new FakeSmsSender();
        }
        return new TermiiSmsSender({
          apiKey,
          senderId: process.env.TERMII_SENDER_ID ?? "Demeterra",
          baseUrl: process.env.TERMII_BASE_URL,
          channel: (process.env.TERMII_CHANNEL as "dnd" | "generic" | "whatsapp") || "dnd",
        });
      },
    },
  ],
  exports: [SMS_SENDER],
})
export class SmsModule {}
