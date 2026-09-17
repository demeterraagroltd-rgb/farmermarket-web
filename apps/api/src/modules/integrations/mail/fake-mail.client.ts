import { Logger, ServiceUnavailableException } from "@nestjs/common";
import type { InboundMail, MailClient, OutboundMail } from "./mail.types";

/**
 * Used when the mailbox env vars aren't set (local dev, CI, tests). A sync
 * run is a safe no-op — the inbox just stays empty — but a reply is a staff
 * member actively trying to send real mail, so unlike EmailService's silent
 * dry-run, that throws a clear error instead of pretending to succeed.
 */
export class FakeMailClient implements MailClient {
  readonly live = false;
  readonly fromAddress = "admin@farmermarket.ng";
  private readonly log = new Logger("FakeMailClient");

  async fetchNew(sinceUid: string | null): Promise<{ messages: InboundMail[]; lastUid: string | null }> {
    this.log.debug("inbox sync skipped — mailbox isn't configured on this environment");
    return { messages: [], lastUid: sinceUid };
  }

  async send(_mail: OutboundMail): Promise<{ messageId: string }> {
    throw new ServiceUnavailableException("The inbox isn't configured on this environment.");
  }
}
