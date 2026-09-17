import { boolean, index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { staff } from "./identity.js";

// Two-way email with the admin mailbox (admin@farmermarket.ng), surfaced in
// the dashboard so replies don't just sit in an inbox nobody on the team
// opens day to day. Threads are grouped by participant address + a
// normalised subject — a real mailbox gives no reliable app-level thread
// id, so Message-ID/In-Reply-To headers (kept on each message) are the
// actual threading signal used at sync time; subject+participant is the
// fallback when a reply doesn't carry them.
export const inboxThreads = pgTable("inbox_threads", {
  id: uuid("id").primaryKey().defaultRandom(),
  participantEmail: text("participant_email").notNull(),
  participantName: text("participant_name"),
  subject: text("subject").notNull(),
  lastMessageAt: timestamp("last_message_at", { withTimezone: true }).notNull().defaultNow(),
  unread: boolean("unread").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const inboxMessages = pgTable(
  "inbox_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    threadId: uuid("thread_id")
      .notNull()
      .references(() => inboxThreads.id, { onDelete: "cascade" }),
    direction: text("direction").notNull(), // 'inbound' | 'outbound'
    fromAddress: text("from_address").notNull(),
    toAddress: text("to_address").notNull(),
    subject: text("subject").notNull(),
    bodyText: text("body_text"),
    bodyHtml: text("body_html"),
    // RFC822 Message-ID — the IMAP sync dedupe key for inbound mail, and the
    // value a reply's In-Reply-To/References point back at for threading in
    // the recipient's own mail client.
    messageId: text("message_id").unique(),
    inReplyTo: text("in_reply_to"),
    sentByStaffId: uuid("sent_by_staff_id").references(() => staff.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    threadIdx: index("inbox_messages_thread_idx").on(t.threadId),
  }),
);

// Singleton row (id is always 'imap') holding the IMAP UID watermark so a
// sync run only fetches what's new since the last one.
export const inboxSyncState = pgTable("inbox_sync_state", {
  id: text("id").primaryKey(),
  lastUid: text("last_uid"),
  lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
});
