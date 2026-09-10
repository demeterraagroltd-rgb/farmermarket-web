import { Logger } from "@nestjs/common";
import type { SmsSender } from "./sms.types";

// Termii plain-SMS send (https://developers.termii.com — Messaging API).
// We deliberately use the plain send endpoint, not Termii's own Token/OTP
// API: the code is generated, hashed and expired on our side (OtpService),
// so Termii is only a delivery pipe and stays swappable.
const DEFAULT_BASE_URL = "https://api.ng.termii.com";

interface TermiiConfig {
  apiKey: string;
  senderId: string;
  baseUrl?: string;
  /**
   * "dnd" routes around the Nigerian Do-Not-Disturb list (required for OTPs
   * to reach most numbers); "generic" is cheaper but silently drops on DND.
   */
  channel?: "dnd" | "generic" | "whatsapp";
}

export class TermiiSmsSender implements SmsSender {
  readonly live = true;
  private readonly log = new Logger("TermiiSmsSender");
  private readonly baseUrl: string;
  private readonly channel: string;

  constructor(private readonly config: TermiiConfig) {
    this.baseUrl = (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.channel = config.channel ?? "dnd";
  }

  async send(to: string, message: string): Promise<void> {
    const res = await fetch(`${this.baseUrl}/api/sms/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: this.config.apiKey,
        to,
        from: this.config.senderId,
        sms: message,
        type: "plain",
        channel: this.channel,
      }),
    });

    const raw = await res.text();
    let body: { message?: string; code?: string | number; message_id?: string; balance?: number } = {};
    try {
      body = JSON.parse(raw);
    } catch {
      /* non-JSON error page */
    }

    // Termii answers 200 with a body for both success and some soft errors,
    // and 4xx for auth/validation. Treat anything but an explicit accepted
    // response as a failure so the caller surfaces "couldn't send the code"
    // rather than a silent no-op.
    const ok =
      res.ok &&
      (body.code === "ok" ||
        typeof body.message_id === "string" ||
        /successfully sent|sent/i.test(body.message ?? ""));
    if (!ok) {
      const detail = body.message || raw.slice(0, 300) || `HTTP ${res.status}`;
      // ERROR level + a stable prefix so it's greppable in Render logs.
      this.log.error(`[termii] send rejected (HTTP ${res.status}): ${detail}`);
      throw new Error(`Termii rejected the message: ${detail}`);
    }
  }
}
