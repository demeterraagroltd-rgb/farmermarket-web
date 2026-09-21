"use client";

import { useState } from "react";
import { KYC_LABEL, KYC_TONE, initials, timeAgo, type Customer360, type TabId } from "../../../lib/customer360";
import { Card } from "../../ui/Card";
import { Badge } from "../../ui/Badge";
import { Button } from "../../ui/Button";
import { useBankRefresh } from "./useBankRefresh";

// The name, status and the handful of things an admin does from any tab.
// Nothing here calls Mono on render — Refresh is an explicit click.
export function CustomerHeader({
  data,
  reload,
  goTab,
}: {
  data: Customer360;
  reload: () => void;
  goTab: (t: TabId) => void;
}) {
  const c = data.customer;
  const { refresh, busy, message } = useBankRefresh(c.id, reload);
  const [copied, setCopied] = useState(false);
  const connected = data.bank.state === "connected";

  function copyId() {
    navigator.clipboard
      ?.writeText(c.id)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => {});
  }

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-center gap-4">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-primary-surface text-lg font-bold text-primary-dark">
            {initials(c.fullName, c.phone)}
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-2xl font-bold tracking-tight text-text-dark">{c.fullName ?? "Unnamed customer"}</h1>
            <div className="mt-1.5 flex flex-wrap items-center gap-2 text-sm text-text-muted">
              <button
                type="button"
                onClick={copyId}
                title={`${c.id} — click to copy`}
                className="rounded font-mono text-xs hover:text-text-dark"
              >
                ID {c.id.slice(0, 8)}… {copied ? "· copied" : ""}
              </button>
              <Badge tone={c.accountStatus === "active" ? "success" : "error"}>
                {c.accountStatus === "active" ? "Active" : "Suspended"}
              </Badge>
              <Badge tone={KYC_TONE[data.summary.kycStatus]}>KYC: {KYC_LABEL[data.summary.kycStatus]}</Badge>
              <span title={new Date(c.lastUpdatedAt).toLocaleString()}>Updated {timeAgo(c.lastUpdatedAt).toLowerCase()}</span>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" onClick={refresh} disabled={busy || !connected} title={!connected ? "No bank account linked" : undefined}>
            {busy ? "Refreshing…" : "Refresh financial data"}
          </Button>
          <Button variant="ghost" onClick={() => goTab("identity")}>
            Verify identity
          </Button>
          <Button variant="ghost" onClick={() => goTab("orders")}>
            View orders
          </Button>
          <Button variant="ghost" onClick={() => goTab("applications")}>
            Credit applications
          </Button>
        </div>
      </div>

      {message && (
        <p className={`mt-3 text-sm ${message.tone === "ok" ? "text-primary" : "text-error"}`}>{message.text}</p>
      )}
      {c.accountStatus === "suspended" && (
        <p className="mt-3 rounded-[var(--radius-sm)] bg-error/10 px-3 py-2 text-sm text-error">
          This account is suspended{c.suspendedReason ? ` — ${c.suspendedReason}` : ""}. The customer can&apos;t sign in.
          Use Activate on the Customers list to restore access.
        </p>
      )}
    </Card>
  );
}
