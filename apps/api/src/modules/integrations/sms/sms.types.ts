// Every third-party integration sits behind an interface with a fake for
// tests and local dev (WEB_APP_PLAN §9). This is the SMS seam: one method,
// so a provider swap (Termii → anything) is a single new file.

export const SMS_SENDER = Symbol("SMS_SENDER");

export interface SmsSender {
  /**
   * Deliver `message` to `to` (a normalised MSISDN, e.g. `2348012345678` —
   * no `+`, no spaces). Resolves on accepted-for-delivery; throws on a hard
   * failure (bad credentials, rejected number, provider 4xx/5xx).
   */
  send(to: string, message: string): Promise<void>;

  /** True when a real provider is wired up — callers can warn in dev otherwise. */
  readonly live: boolean;
}
