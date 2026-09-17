// The inbox seam: IMAP receive + SMTP send behind one interface, with a
// fake for tests and local dev — same shape as the SMS and Mono seams
// (WEB_APP_PLAN §9). A provider swap (a different mailbox host) is a
// single new file.

export const MAIL_CLIENT = Symbol("MAIL_CLIENT");

export interface InboundMail {
  messageId: string;
  inReplyTo: string | null;
  from: { address: string; name: string | null };
  to: string;
  subject: string;
  text: string | null;
  html: string | null;
  date: Date;
}

export interface OutboundMail {
  to: string;
  subject: string;
  text: string;
  html?: string;
  /** Message-ID being replied to, for In-Reply-To/References threading. */
  inReplyToMessageId?: string | null;
}

export interface MailClient {
  /** Fetch inbound mail newer than `sinceUid` (IMAP UID watermark, null = first run). */
  fetchNew(sinceUid: string | null): Promise<{ messages: InboundMail[]; lastUid: string | null }>;
  /** Send a reply. Resolves with the sent message's Message-ID. */
  send(mail: OutboundMail): Promise<{ messageId: string }>;
  /** The mailbox address mail is sent from, for record-keeping. */
  readonly fromAddress: string;
  /** True when a real mailbox is wired up. */
  readonly live: boolean;
}
