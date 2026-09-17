import { Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { desc, eq } from "drizzle-orm";
import { inboxMessages, inboxSyncState, inboxThreads, type Db } from "@farmermarket/db";
import { DB } from "../../db/db.module";
import { MAIL_CLIENT, type MailClient } from "../integrations/mail/mail.types";

const SYNC_STATE_ID = "imap";

function normaliseSubject(subject: string): string {
  return (
    subject
      .replace(/^\s*(re|fwd?)\s*:\s*/i, "")
      .trim()
      .toLowerCase() || "(no subject)"
  );
}

/**
 * The admin mailbox (admin@farmermarket.ng), synced into the dashboard so
 * staff can read and answer customer mail without leaving the app.
 *
 * `sync()` pulls whatever's new via IMAP and stores it — called on a
 * schedule (a GitHub Actions cron, same pattern as collections) rather than
 * kept open, since Render's free tier has no persistent worker. `reply()`
 * sends over SMTP and records what was sent.
 */
@Injectable()
export class InboxService {
  private readonly log = new Logger("InboxService");

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(MAIL_CLIENT) private readonly mail: MailClient,
  ) {}

  async sync(): Promise<{ fetched: number }> {
    const [state] = await this.db
      .select()
      .from(inboxSyncState)
      .where(eq(inboxSyncState.id, SYNC_STATE_ID));
    const { messages, lastUid } = await this.mail.fetchNew(state?.lastUid ?? null);

    for (const m of messages) {
      const [existing] = await this.db
        .select({ id: inboxMessages.id })
        .from(inboxMessages)
        .where(eq(inboxMessages.messageId, m.messageId));
      if (existing) continue; // already stored — sync is safe to re-run

      const threadId = await this.findOrCreateThread({
        participantEmail: m.from.address,
        participantName: m.from.name,
        subject: m.subject,
        inReplyTo: m.inReplyTo,
      });

      await this.db.insert(inboxMessages).values({
        threadId,
        direction: "inbound",
        fromAddress: m.from.address,
        toAddress: m.to,
        subject: m.subject,
        bodyText: m.text,
        bodyHtml: m.html,
        messageId: m.messageId,
        inReplyTo: m.inReplyTo,
        createdAt: m.date,
      });
      await this.db
        .update(inboxThreads)
        .set({ lastMessageAt: m.date, unread: true })
        .where(eq(inboxThreads.id, threadId));
    }

    if (state) {
      await this.db
        .update(inboxSyncState)
        .set({ lastUid, lastSyncedAt: new Date() })
        .where(eq(inboxSyncState.id, SYNC_STATE_ID));
    } else {
      await this.db.insert(inboxSyncState).values({ id: SYNC_STATE_ID, lastUid, lastSyncedAt: new Date() });
    }

    if (messages.length) this.log.log(`inbox sync: stored ${messages.length} new message(s)`);
    return { fetched: messages.length };
  }

  private async findOrCreateThread(input: {
    participantEmail: string;
    participantName: string | null;
    subject: string;
    inReplyTo: string | null;
  }): Promise<string> {
    // Prefer matching by In-Reply-To against a message already stored — the
    // reliable signal when the sender's mail client sets it. Falls back to
    // participant + normalised subject, which is what most real mailboxes
    // actually give us to work with.
    if (input.inReplyTo) {
      const [parent] = await this.db
        .select({ threadId: inboxMessages.threadId })
        .from(inboxMessages)
        .where(eq(inboxMessages.messageId, input.inReplyTo));
      if (parent) return parent.threadId;
    }

    const normalised = normaliseSubject(input.subject);
    const candidates = await this.db
      .select({ id: inboxThreads.id, subject: inboxThreads.subject })
      .from(inboxThreads)
      .where(eq(inboxThreads.participantEmail, input.participantEmail));
    const match = candidates.find((c) => normaliseSubject(c.subject) === normalised);
    if (match) return match.id;

    const [created] = await this.db
      .insert(inboxThreads)
      .values({
        participantEmail: input.participantEmail,
        participantName: input.participantName,
        subject: input.subject,
      })
      .returning({ id: inboxThreads.id });
    return created.id;
  }

  async listThreads() {
    return this.db
      .select({
        id: inboxThreads.id,
        participantEmail: inboxThreads.participantEmail,
        participantName: inboxThreads.participantName,
        subject: inboxThreads.subject,
        lastMessageAt: inboxThreads.lastMessageAt,
        unread: inboxThreads.unread,
      })
      .from(inboxThreads)
      .orderBy(desc(inboxThreads.lastMessageAt));
  }

  async getThread(id: string) {
    const [thread] = await this.db.select().from(inboxThreads).where(eq(inboxThreads.id, id));
    if (!thread) throw new NotFoundException("Thread not found");

    if (thread.unread) {
      await this.db.update(inboxThreads).set({ unread: false }).where(eq(inboxThreads.id, id));
    }

    const messages = await this.db
      .select()
      .from(inboxMessages)
      .where(eq(inboxMessages.threadId, id))
      .orderBy(inboxMessages.createdAt);

    return { thread: { ...thread, unread: false }, messages };
  }

  async reply(threadId: string, staffId: string, body: { text: string }) {
    const [thread] = await this.db.select().from(inboxThreads).where(eq(inboxThreads.id, threadId));
    if (!thread) throw new NotFoundException("Thread not found");

    const [lastInbound] = await this.db
      .select({ messageId: inboxMessages.messageId })
      .from(inboxMessages)
      .where(eq(inboxMessages.threadId, threadId))
      .orderBy(desc(inboxMessages.createdAt))
      .limit(1);

    const subject = /^\s*re\s*:/i.test(thread.subject) ? thread.subject : `Re: ${thread.subject}`;
    const { messageId } = await this.mail.send({
      to: thread.participantEmail,
      subject,
      text: body.text,
      inReplyToMessageId: lastInbound?.messageId ?? null,
    });

    await this.db.insert(inboxMessages).values({
      threadId,
      direction: "outbound",
      fromAddress: this.mail.fromAddress,
      toAddress: thread.participantEmail,
      subject,
      bodyText: body.text,
      messageId,
      sentByStaffId: staffId,
    });
    await this.db
      .update(inboxThreads)
      .set({ lastMessageAt: new Date(), unread: false })
      .where(eq(inboxThreads.id, threadId));

    return { sent: true };
  }
}
