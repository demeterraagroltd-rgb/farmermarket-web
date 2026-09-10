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

    const body = (await res.json().catch(() => ({}))) as {
      message?: string;
      code?: string | number;
    };

    // Termii answers 200 with a body for both success and some soft errors,
    // and 4xx for auth/validation. Treat anything but an explicit "ok" as a
    // failure so the caller surfaces "couldn't send the code" rather than a
    // silent no-op.
    const ok = res.ok && (body.code === "ok" || /successfully sent/i.test(body.message ?? ""));
    if (!ok) {
      this.log.warn(`Termii send failed (${res.status}): ${body.message ?? "no message"}`);
      throw new Error(body.message || `SMS provider returned ${res.status}`);
    }
  }
}
