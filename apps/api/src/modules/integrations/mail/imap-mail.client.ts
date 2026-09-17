import { Logger } from "@nestjs/common";
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import nodemailer, { type Transporter } from "nodemailer";
import type { InboundMail, MailClient, OutboundMail } from "./mail.types";

export interface ImapMailClientOptions {
  imapHost: string;
  imapPort: number;
  imapSecure: boolean;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  user: string;
  password: string;
  fromAddress: string; // e.g. "Farmer Market <admin@farmermarket.ng>"
}

const BACKFILL_ON_FIRST_SYNC = 20;

export class ImapMailClient implements MailClient {
  readonly live = true;
  readonly fromAddress: string;
  private readonly log = new Logger("ImapMailClient");
  private readonly transporter: Transporter;

  constructor(private readonly opts: ImapMailClientOptions) {
    this.fromAddress = opts.fromAddress;
    this.transporter = nodemailer.createTransport({
      host: opts.smtpHost,
      port: opts.smtpPort,
      secure: opts.smtpSecure,
      auth: { user: opts.user, pass: opts.password },
    });
  }

  async fetchNew(sinceUid: string | null): Promise<{ messages: InboundMail[]; lastUid: string | null }> {
    const client = new ImapFlow({
      host: this.opts.imapHost,
      port: this.opts.imapPort,
      secure: this.opts.imapSecure,
      auth: { user: this.opts.user, pass: this.opts.password },
      logger: false,
    });

    const messages: InboundMail[] = [];
    let lastUid = sinceUid;

    await client.connect();
    try {
      const lock = await client.getMailboxLock("INBOX");
      try {
        const status = await client.status("INBOX", { messages: true });
        const total = status.messages ?? 0;
        if (total === 0) return { messages, lastUid };

        // First sync: back-fill roughly the most recent N so the inbox
        // isn't empty. Every sync after: only UIDs past the watermark left
        // by the previous run.
        const range = sinceUid
          ? `${Number(sinceUid) + 1}:*`
          : `${Math.max(1, total - BACKFILL_ON_FIRST_SYNC + 1)}:*`;

        for await (const msg of client.fetch(range, { uid: true, source: true }, { uid: true })) {
          if (!msg.source) continue;
          const parsed = await simpleParser(msg.source);
          const from = parsed.from?.value?.[0];
          if (!from?.address) continue;

          messages.push({
            messageId: parsed.messageId ?? `imap-${msg.uid}@${this.opts.imapHost}`,
            inReplyTo: parsed.inReplyTo ?? null,
            from: { address: from.address.toLowerCase(), name: from.name ?? null },
            to: this.opts.user,
            subject: parsed.subject ?? "(no subject)",
            text: parsed.text || null,
            html: typeof parsed.html === "string" ? parsed.html : null,
            date: parsed.date ?? new Date(),
          });
          if (lastUid === null || msg.uid > Number(lastUid)) lastUid = String(msg.uid);
        }
      } finally {
        lock.release();
      }
    } finally {
      await client.logout().catch(() => undefined);
    }

    return { messages, lastUid };
  }

  async send(mail: OutboundMail): Promise<{ messageId: string }> {
    const info = await this.transporter.sendMail({
      from: this.opts.fromAddress,
      to: mail.to,
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
      inReplyTo: mail.inReplyToMessageId ?? undefined,
      references: mail.inReplyToMessageId ?? undefined,
    });
    return { messageId: info.messageId };
  }
}
