"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { apiFetch, getToken } from "../../../../../lib/auth";
import { formatDateTime } from "../../../../../lib/format";
import { PageHeader, Card } from "../../../../../components/ui/Card";
import { Button } from "../../../../../components/ui/Button";
import { Textarea } from "../../../../../components/ui/Field";

interface Message {
  id: string;
  direction: "inbound" | "outbound";
  fromAddress: string;
  toAddress: string;
  subject: string;
  bodyText: string | null;
  bodyHtml: string | null;
  createdAt: string;
}

interface Thread {
  id: string;
  participantEmail: string;
  participantName: string | null;
  subject: string;
}

interface Detail {
  thread: Thread;
  messages: Message[];
}

// Inbound mail is fully attacker-controlled — anyone can email this address.
// bodyText normally covers it (mailparser derives plain text from an
// HTML-only message), but if only bodyHtml ever shows up, strip tags rather
// than risk dangerouslySetInnerHTML on content nobody here wrote.
function plainTextFromHtml(html: string): string {
  return html
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export default function InboxThreadPage() {
  const router = useRouter();
  const params = useParams<{ threadId: string }>();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  const load = useCallback(() => {
    apiFetch(`/v1/admin/inbox/threads/${params.threadId}`)
      .then(async (res) => {
        if (res.status === 401) return router.push("/login");
        const body = await res.json();
        if (!res.ok) throw new Error(body.message ?? `Failed to load (${res.status})`);
        setDetail(body);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"));
  }, [params.threadId, router]);

  useEffect(() => {
    if (!getToken()) {
      router.push("/login");
      return;
    }
    load();
  }, [load, router]);

  async function sendReply() {
    if (!reply.trim()) return;
    setSending(true);
    setSendError(null);
    try {
      const res = await apiFetch(`/v1/admin/inbox/threads/${params.threadId}/reply`, {
        method: "POST",
        body: JSON.stringify({ text: reply }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.message ?? `Failed to send (${res.status})`);
      setReply("");
      load();
    } catch (e) {
      setSendError(e instanceof Error ? e.message : "Failed to send");
    } finally {
      setSending(false);
    }
  }

  if (error) return <p className="mx-auto max-w-3xl p-6 text-sm text-error">{error}</p>;
  if (!detail) {
    return (
      <div className="mx-auto max-w-3xl animate-pulse">
        <div className="h-24 rounded-[var(--radius-lg)] bg-dark-border/20" />
      </div>
    );
  }

  const { thread, messages } = detail;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <PageHeader
        title={thread.subject}
        description={`${thread.participantName ? `${thread.participantName} · ` : ""}${thread.participantEmail}`}
      />

      <div className="flex flex-col gap-3">
        {messages.map((m) => (
          <Card
            key={m.id}
            className={`p-4 ${m.direction === "outbound" ? "ml-8 bg-primary-surface" : "mr-8"}`}
          >
            <div className="mb-2 flex items-center justify-between text-xs text-text-muted">
              <span className="font-semibold text-text-dark">
                {m.direction === "outbound" ? m.fromAddress : m.fromAddress}
              </span>
              <span>{formatDateTime(m.createdAt)}</span>
            </div>
            {m.bodyText ? (
              <p className="whitespace-pre-wrap text-sm text-text-dark">{m.bodyText}</p>
            ) : m.bodyHtml ? (
              <p className="whitespace-pre-wrap text-sm text-text-dark">{plainTextFromHtml(m.bodyHtml)}</p>
            ) : (
              <p className="text-sm text-text-muted">(empty message)</p>
            )}
          </Card>
        ))}
      </div>

      <Card className="p-4">
        <Textarea
          label="Reply"
          rows={5}
          value={reply}
          onChange={(e) => setReply(e.target.value)}
          placeholder={`Reply to ${thread.participantEmail}…`}
        />
        {sendError && <p className="mt-2 text-sm text-error">{sendError}</p>}
        <div className="mt-3 flex justify-end">
          <Button onClick={sendReply} disabled={sending || !reply.trim()}>
            {sending ? "Sending…" : "Send reply"}
          </Button>
        </div>
      </Card>
    </div>
  );
}
