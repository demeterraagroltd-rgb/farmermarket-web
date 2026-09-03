"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { apiFetch, getToken } from "../../../../lib/auth";
import { formatDateTime } from "../../../../lib/format";
import { PageHeader, Card, EmptyState } from "../../../../components/ui/Card";
import { Badge } from "../../../../components/ui/Badge";

interface QueueRow {
  userId: string;
  fullName: string;
  phone: string;
  email: string | null;
  verificationStatus: string;
  submittedAt: string | null;
  documentCount: number;
  pendingDocuments: number;
}

const TONE: Record<string, "neutral" | "info" | "success" | "error" | "gold"> = {
  submitted: "gold",
  needs_more_info: "error",
  verified: "success",
  unverified: "neutral",
};

export default function KycQueuePage() {
  const router = useRouter();
  const [rows, setRows] = useState<QueueRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!getToken()) {
      router.push("/login");
      return;
    }
    apiFetch("/v1/admin/kyc")
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
        title="Verification"
        description="Customers waiting to be verified. Review their details and documents, then verify or send it back."
      />
      {error && <p className="text-sm text-error">{error}</p>}

      {rows === null ? (
        <div className="flex animate-pulse flex-col gap-3">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-[76px] rounded-[var(--radius-lg)] bg-dark-border/20" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <EmptyState label="Nobody's waiting for verification right now." />
      ) : (
        <div className="flex flex-col gap-3">
          {rows.map((r) => (
            <Link key={r.userId} href={`/dashboard/kyc/${r.userId}`}>
              <Card className="p-5 transition-colors hover:border-primary">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-text-dark">{r.fullName}</span>
                      <Badge tone={TONE[r.verificationStatus] ?? "neutral"}>
                        {r.verificationStatus.replace(/_/g, " ")}
                      </Badge>
                    </div>
                    <p className="text-xs text-text-muted">
                      {r.phone} · {r.email ?? "no email"} ·{" "}
                      {r.submittedAt ? `submitted ${formatDateTime(r.submittedAt)}` : "not submitted"}
                    </p>
                  </div>
                  <div className="text-right text-xs text-text-muted">
                    {r.documentCount} document{r.documentCount === 1 ? "" : "s"}
                    {r.pendingDocuments > 0 && (
                      <span className="ml-1 font-semibold text-gold-dark">
                        ({r.pendingDocuments} to review)
                      </span>
                    )}
                  </div>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
