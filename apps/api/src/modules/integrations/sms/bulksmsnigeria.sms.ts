import type { SmsSender } from "./sms.types";

/** Public v2 contract: https://www.bulksmsnigeria.com/api (25 October 2026).
 * One recipient per request. Never retry an ambiguous paid send or log its
 * body: SMS can contain OTPs and consent links. */
export class BulkSmsNigeriaSender implements SmsSender {
  readonly live = true;

  constructor(private readonly config: { apiToken: string; senderId: string }) {
    if (!config.apiToken || /\s/.test(config.apiToken)) throw new Error("Set a bare BULKSMSNIGERIA_API_TOKEN without Bearer or whitespace.");
    if (!/^[A-Za-z0-9][A-Za-z0-9 ._-]{0,10}$/.test(config.senderId)) throw new Error("Set BULKSMSNIGERIA_SENDER_ID to your approved sender name (1–11 characters).");
  }

  async send(to: string, message: string): Promise<void> {
    if (!/^234\d{10}$/.test(to)) throw new Error("SMS recipient must be a Nigerian number in 234 format.");
    if (!message.trim() || message.length > 1530) throw new Error("SMS message must contain 1–1530 characters.");
    let response: Response;
    let body: { status?: string; code?: string; data?: { message_id?: string; recipients_count?: number; gateway_used?: string; requested_gateway?: string; route_notice?: string } };
    try {
      response = await fetch("https://www.bulksmsnigeria.com/api/v2/sms", {
        method: "POST", redirect: "error", signal: AbortSignal.timeout(20_000),
        headers: { Authorization: `Bearer ${this.config.apiToken}`, "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ from: this.config.senderId, to, body: message, gateway: "corporate", unicode: false }),
      });
      body = await response.json() as typeof body;
    } catch {
      throw new Error("BulkSMSNigeria delivery is unconfirmed. Check provider records before resending.");
    }
    // Do not reflect a provider error: it may echo the token, phone or SMS.
    if (!response.ok || !body || body.status !== "success" || body.code !== "BSNG-0000"
      || typeof body.data?.message_id !== "string" || !body.data.message_id || body.data.recipients_count !== 1) {
      throw new Error(`BulkSMSNigeria did not confirm acceptance (HTTP ${response.status}). Check the provider dashboard before resending.`);
    }
    // The documented API can accept the message on direct-refund when the
    // requested corporate route is unavailable. It already charged/sent it:
    // preserve acceptance instead of turning that outcome into a retry.
    const documentedFallback = body.data.gateway_used === "direct-refund"
      && body.data.requested_gateway === "corporate"
      && typeof body.data.route_notice === "string" && !!body.data.route_notice.trim();
    if (!["corporate", "direct-corporate", "otp"].includes(body.data.gateway_used ?? "") && !documentedFallback)
      throw new Error("BulkSMSNigeria used an unexpected route. Check transactional sender approval and delivery before resending.");
  }
}
