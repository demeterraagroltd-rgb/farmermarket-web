import { Global, Logger, Module } from "@nestjs/common";
import { MAIL_CLIENT } from "./mail.types";
import { ImapMailClient } from "./imap-mail.client";
import { FakeMailClient } from "./fake-mail.client";

// Global so InboxService can inject MAIL_CLIENT without every module
// re-importing this. Picks the real IMAP/SMTP client only when the mailbox
// credentials are present — otherwise the fake, exactly like SmsModule and
// NotificationsModule.
@Global()
@Module({
  providers: [
    {
      provide: MAIL_CLIENT,
      useFactory: () => {
        const host = process.env.INBOX_IMAP_HOST;
        const user = process.env.INBOX_EMAIL_USER;
        const password = process.env.INBOX_EMAIL_PASSWORD;
        if (!host || !user || !password) {
          new Logger("MailModule").warn(
            "INBOX_IMAP_HOST / INBOX_EMAIL_USER / INBOX_EMAIL_PASSWORD not set — the inbox stays empty and replies are refused.",
          );
          return new FakeMailClient();
        }
        return new ImapMailClient({
          imapHost: host,
          imapPort: Number(process.env.INBOX_IMAP_PORT ?? 993),
          imapSecure: process.env.INBOX_IMAP_SECURE !== "false",
          smtpHost: process.env.INBOX_SMTP_HOST || host,
          smtpPort: Number(process.env.INBOX_SMTP_PORT ?? 465),
          smtpSecure: process.env.INBOX_SMTP_SECURE !== "false",
          user,
          password,
          fromAddress: process.env.INBOX_EMAIL_FROM ?? `Farmer Market <${user}>`,
        });
      },
    },
  ],
  exports: [MAIL_CLIENT],
})
export class MailModule {}
