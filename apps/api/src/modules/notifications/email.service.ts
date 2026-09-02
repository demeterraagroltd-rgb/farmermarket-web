import { Injectable, Logger } from "@nestjs/common";

interface EmailInput {
  to: string | null | undefined;
  subject: string;
  html: string;
}

/**
 * Thin Resend wrapper. When `RESEND_API_KEY` isn't set (e.g. before the key
 * lands) it logs the message and returns — no flow is ever blocked by email.
 */
@Injectable()
export class EmailService {
  private readonly log = new Logger(EmailService.name);
  private readonly from = process.env.EMAIL_FROM ?? "Farmer Market <noreply@farmermarket.africa>";

  async send({ to, subject, html }: EmailInput): Promise<void> {
    if (!to) return;
    const key = process.env.RESEND_API_KEY;
    if (!key) {
      this.log.log(`[email:dry-run] to=${to} subject="${subject}"`);
      return;
    }
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from: this.from, to, subject, html }),
      });
      if (!res.ok) {
        this.log.warn(`Resend responded ${res.status}: ${await res.text()}`);
      }
    } catch (err) {
      this.log.warn(`Email send failed: ${(err as Error).message}`);
    }
  }
}
