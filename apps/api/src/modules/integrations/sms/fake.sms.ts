import { Logger } from "@nestjs/common";
import type { SmsSender } from "./sms.types";

/**
 * Used when `TERMII_API_KEY` isn't set (local dev, CI, tests) — the same
 * "no key ⇒ dry run, nothing blocks" behaviour as EmailService. It logs the
 * message (so a developer can read the code out of the server output and
 * finish the Sign Up flow) and remembers the last one for assertions.
 */
export class FakeSmsSender implements SmsSender {
  readonly live = false;
  private readonly log = new Logger("FakeSmsSender");

  readonly sent: Array<{ to: string; message: string; at: Date }> = [];

  async send(to: string, message: string): Promise<void> {
    this.sent.push({ to, message, at: new Date() });
    this.log.log(`[sms:dry-run] to=${to} message="${message}"`);
  }

  get last() {
    return this.sent.at(-1);
  }
}
