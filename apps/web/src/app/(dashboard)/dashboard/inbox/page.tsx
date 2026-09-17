"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { apiFetch, getToken } from "../../../../lib/auth";
import { formatDateTime } from "../../../../lib/format";
import { PageHeader, Card, EmptyState } from "../../../../components/ui/Card";
import { Badge } from "../../../../components/ui/Badge";

interface ThreadRow {
  id: string;
  participantEmail: string;
  participantName: string | null;
  subject: string;
  lastMessageAt: string;
  unread: boolean;
}

export default function InboxPage() {
  const router = useRouter();
  const [rows, setRows] = useState<ThreadRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!getToken()) {
      router.push("/login");
      return;
    }
    apiFetch("/v1/admin/inbox/threads")
      .then(async (res) => {
        if (res.status === 401) return router.push("/login");
        const body = await res.json();
        if (!res.ok) throw new Error(body.message ?? `Failed to load (${res.status})`);
        setRows(body);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"));
  }, [router]);

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <PageHeader
        title="Inbox"
        description="Mail sent to admin@farmermarket.ng, synced in every few minutes. Reply here and it goes out from that address."
      />
      {error && <p className="text-sm text-error">{error}</p>}

      {rows === null ? (
        <div className="flex animate-pulse flex-col gap-3">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-[68px] rounded-[var(--radius-lg)] bg-dark-border/20" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <EmptyState label="Nothing here yet — mail to admin@farmermarket.ng will show up after the next sync." />
      ) : (
        <div className="flex flex-col gap-3">
          {rows.map((r) => (
            <Link key={r.id} href={`/dashboard/inbox/${r.id}`}>
              <Card className={`p-5 transition-colors hover:border-primary ${r.unread ? "border-primary/40" : ""}`}>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className={`font-semibold text-text-dark ${r.unread ? "" : ""}`}>
                        {r.participantName || r.participantEmail}
                      </span>
                      {r.unread && <Badge tone="info">unread</Badge>}
                    </div>
                    <p className="text-xs text-text-muted">{r.participantEmail}</p>
                    <p className="mt-1 text-sm text-text-medium">{r.subject}</p>
                  </div>
                  <div className="text-right text-xs text-text-muted">{formatDateTime(r.lastMessageAt)}</div>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
