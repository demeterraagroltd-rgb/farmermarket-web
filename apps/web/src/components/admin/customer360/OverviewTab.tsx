"use client";

import { Badge } from "../../ui/Badge";
import { Button } from "../../ui/Button";
import { formatDate, formatDateTime, formatNaira, formatNairaAmount } from "../../../lib/format";
import {
  ACTION_LABEL,
  BANK_LABEL,
  BANK_TONE,
  COLLECTION_LABEL,
  COLLECTION_TONE,
  VERIFICATION_LABEL,
  VERIFICATION_TONE,
  timeAgo,
} from "../../../lib/customer360";
import { FreshnessBadge, Row, Section, Updated, type TabProps } from "./parts";
import { useBankRefresh } from "./useBankRefresh";

const BAND: Record<string, { label: string; tone: "success" | "warning" | "error" | "neutral" }> = {
  matches: { label: "Matches declared", tone: "success" },
  moderate: { label: "Differs moderately", tone: "warning" },
  large: { label: "Differs a lot", tone: "error" },
  unknown: { label: "Can't compare", tone: "neutral" },
};

// Overview: one card per area, each a summary with a way into the tab that
// explains it. Progressive disclosure — headline first, detail a click away.
export function OverviewTab({ data, reload, goTab }: TabProps) {
  const { customer, identity, bank, financial, credit, repayments, audit } = data;
  const { refresh, busy, message } = useBankRefresh(customer.id, reload);
  const connected = bank.state === "connected";
  const utilisation = credit.totalLimit > 0 ? Math.min(100, Math.round((credit.usedAmount / credit.totalLimit) * 100)) : 0;
  const band = BAND[financial.income.band];

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {/* Freshness — the spec's "how current is what I'm looking at" panel */}
      <Section
        title="Data freshness"
        description="What we hold and how recent it is. Opening this page never calls Mono."
        action={
          <Button variant="secondary" onClick={refresh} disabled={busy || !connected}>
            {busy ? "Refreshing…" : "Refresh data"}
          </Button>
        }
      >
        <Row
          label="Financial data"
          value={
            financial.retrievedAt ? (
              <span className="flex items-center gap-2">
                <Updated at={financial.retrievedAt} /> <FreshnessBadge freshness={financial.freshness} />
              </span>
            ) : (
              "Not pulled yet"
            )
          }
        />
        <Row label="Bank connection" value={<Badge tone={BANK_TONE[bank.state]}>{BANK_LABEL[bank.state]}</Badge>} />
        <Row
          label="Transactions"
          value={
            bank.transactions.count > 0
              ? `${bank.transactions.count.toLocaleString()} stored · ${formatDate(bank.transactions.earliest)} – ${formatDate(bank.transactions.latest)}`
              : financial.monthsAnalysed > 0
                ? `None stored yet (analysed over ${financial.monthsAnalysed} months from a summary)`
                : "None stored"
          }
        />
        <Row label="Income" value={financial.retrievedAt ? <Updated at={financial.retrievedAt} /> : "Not pulled yet"} />
        <Row
          label="Identity verification"
          value={
            identity.mashup.verifiedAt ?? identity.bvn.verifiedAt ?? identity.nin.verifiedAt
              ? `Verified ${formatDate(identity.mashup.verifiedAt ?? identity.bvn.verifiedAt ?? identity.nin.verifiedAt)}`
              : "Not checked"
          }
        />
        {!connected && (
          <p className="mt-2 text-xs text-text-muted">
            There&apos;s no linked bank account to refresh. Request one from the Bank Accounts tab.
          </p>
        )}
        {message && (
          <p className={`mt-2 text-xs ${message.tone === "ok" ? "text-primary" : "text-error"}`}>{message.text}</p>
        )}
      </Section>

      <Section
        title="Identity"
        description="Checked against government records."
        action={
          <Button variant="ghost" onClick={() => goTab("identity")}>
            Details
          </Button>
        }
      >
        {(["bvn", "nin", "mashup"] as const).map((k) => (
          <Row
            key={k}
            label={k === "mashup" ? "BVN + NIN" : k.toUpperCase()}
            value={
              <span className="flex flex-wrap items-center gap-2">
                <Badge tone={VERIFICATION_TONE[identity[k].state]}>{VERIFICATION_LABEL[identity[k].state]}</Badge>
                {identity[k].sandbox && <Badge tone="warning">Sandbox</Badge>}
                {identity[k].verifiedAt && (
                  <span className="text-xs font-normal text-text-muted">{formatDate(identity[k].verifiedAt)}</span>
                )}
              </span>
            }
          />
        ))}
      </Section>

      <Section
        title="Income"
        description="What the bank shows against what they declared."
        action={
          <Button variant="ghost" onClick={() => goTab("financial")}>
            Analysis
          </Button>
        }
      >
        <Row label="Declared" value={financial.income.declaredKobo == null ? null : formatNaira(financial.income.declaredKobo)} origin="declared" />
        <Row label="Estimated" value={financial.income.estimatedKobo == null ? null : formatNaira(financial.income.estimatedKobo)} origin="bank" />
        <Row label="Comparison" value={<Badge tone={band.tone}>{band.label}</Badge>} />
        <Row
          label="Employer"
          value={
            financial.employerMatch === null ? null : (
              <Badge tone={financial.employerMatch ? "success" : "error"}>
                {financial.employerMatch ? "Matched" : "Not matched"}
              </Badge>
            )
          }
        />
      </Section>

      <Section
        title="Credit position"
        action={
          <Button variant="ghost" onClick={() => goTab("repayments")}>
            Repayments
          </Button>
        }
      >
        <Row label="Limit" value={formatNairaAmount(credit.totalLimit)} />
        <Row label="In use" value={formatNairaAmount(credit.usedAmount)} />
        <Row label="Available" value={formatNairaAmount(credit.availableAmount)} />
        <Row label="Tier" value={credit.tier === "None" ? null : <Badge tone="gold">{credit.tier}</Badge>} />
        {credit.totalLimit > 0 && (
          <div className="mt-2 flex items-center gap-2">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface">
              <div
                className={`h-full rounded-full ${utilisation >= 90 ? "bg-error" : utilisation >= 70 ? "bg-warning" : "bg-primary"}`}
                style={{ width: `${utilisation}%` }}
              />
            </div>
            <span className="w-9 text-right text-xs tabular-nums text-text-muted">{utilisation}%</span>
          </div>
        )}
      </Section>

      <Section
        title="Repayments"
        action={
          <Button variant="ghost" onClick={() => goTab("repayments")}>
            Details
          </Button>
        }
      >
        <Row
          label="Status"
          value={<Badge tone={COLLECTION_TONE[repayments.summary.collectionStatus]}>{COLLECTION_LABEL[repayments.summary.collectionStatus]}</Badge>}
        />
        <Row label="Outstanding" value={formatNairaAmount(repayments.summary.outstanding)} />
        <Row
          label="Next payment"
          value={
            repayments.summary.nextPayment
              ? `${formatNairaAmount(repayments.summary.nextPayment.amountDue)} · ${formatDate(repayments.summary.nextPayment.dueDate)}`
              : null
          }
        />
      </Section>

      <Section
        title="Recent activity"
        action={
          <Button variant="ghost" onClick={() => goTab("activity")}>
            All activity
          </Button>
        }
      >
        {audit.length === 0 ? (
          <p className="text-sm text-text-muted">Nothing recorded yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {audit.slice(0, 5).map((a) => (
              <li key={a.id} className="flex items-baseline justify-between gap-3 text-sm">
                <span className="text-text-dark">
                  {ACTION_LABEL[a.action] ?? a.action}
                  {a.staff && <span className="text-text-muted"> · {a.staff.name}</span>}
                </span>
                <span className="shrink-0 text-xs text-text-muted" title={formatDateTime(a.at)}>
                  {timeAgo(a.at)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}
