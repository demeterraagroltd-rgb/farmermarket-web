import { Injectable, Logger } from "@nestjs/common";

interface EmailInput {
  to: string | null | undefined;
  subject: string;
  html: string;
  /** Overrides the default reply-to for this one message (rare). */
  replyTo?: string;
}

/**
 * Thin Resend wrapper. When `RESEND_API_KEY` isn't set (e.g. before the key
 * lands) it logs the message and returns — no flow is ever blocked by email.
 *
 * Every message carries a `reply_to` (default `EMAIL_REPLY_TO`, falling back to
 * admin@demeterra.ng) so a customer hitting "reply" reaches a monitored inbox
 * rather than the unattended `from` address.
 */
@Injectable()
export class EmailService {
  private readonly log = new Logger(EmailService.name);
  private readonly from = process.env.EMAIL_FROM ?? "Demeterra <noreply@demeterra.ng>";
  private readonly replyTo = process.env.EMAIL_REPLY_TO ?? "admin@demeterra.ng";

  async send({ to, subject, html, replyTo }: EmailInput): Promise<void> {
    if (!to) return;
    const replyAddress = replyTo ?? this.replyTo;
    const key = process.env.RESEND_API_KEY;
    if (!key) {
      this.log.log(`[email:dry-run] to=${to} reply-to=${replyAddress} subject="${subject}"`);
      return;
    }
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from: this.from, to, subject, html, reply_to: replyAddress }),
      });
      if (!res.ok) {
        this.log.warn(`Resend responded ${res.status}: ${await res.text()}`);
      }
    } catch (err) {
      this.log.warn(`Email send failed: ${(err as Error).message}`);
    }
  }
}
