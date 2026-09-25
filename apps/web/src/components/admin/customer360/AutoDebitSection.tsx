"use client";

import { useState } from "react";
import { Badge } from "../../ui/Badge";
import { Button } from "../../ui/Button";
import { apiFetch } from "../../../lib/auth";
import { formatDate, formatDateTime, formatNaira } from "../../../lib/format";
import { canSeeRawData, type AutoDebitStaffView } from "../../../lib/customer360";
import { DataTable, Row, Section, Td } from "./parts";
import { useStoredData } from "./useStoredData";

// Staff view of a customer's automatic repayment: the mandate, and every debit
// attempt with the bank's reason when one fails. Reads stored state only.
// Cancelling and resolving a flagged debit are admin-only, like the API.

const MANDATE_TONE = {
  awaiting_authorisation: "warning",
  approved: "info",
  active: "success",
  paused: "warning",
  cancelled: "neutral",
  rejected: "error",
  expired: "neutral",
} as const;

const ATTEMPT_TONE = { initiated: "neutral", processing: "info", successful: "success", failed: "warning", needs_review: "error" } as const;
const ATTEMPT_LABEL = { initiated: "Sending", processing: "Processing", successful: "Collected", failed: "Failed", needs_review: "Needs review" } as const;

export function AutoDebitSection({ customerId, role }: { customerId: string; role: string | null }) {
  const { data, error, reload } = useStoredData<AutoDebitStaffView>(`/v1/admin/customers/${customerId}/auto-debit`);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const isAdmin = canSeeRawData(role);

  async function call(path: string, init: RequestInit, done: string) {
    setBusy(true);
    setNote(null);
    try {
      const res = await apiFetch(path, init);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.message ?? `Failed (${res.status})`);
      setNote({ tone: "ok", text: done });
      reload();
    } catch (e) {
      setNote({ tone: "error", text: e instanceof Error ? e.message : "Failed" });
    } finally {
      setBusy(false);
    }
  }

  if (error && !data) return null; // a side panel; never breaks the tab
  if (!data) return null;
  if (!data.available && !data.mandate) {
    return (
      <Section title="Automatic repayment">
        <p className="text-sm text-text-muted">Not switched on yet — customers can&apos;t set it up, and nothing is debited automatically.</p>
      </Section>
    );
  }

  const m = data.mandate;
  const live = m && ["awaiting_authorisation", "approved", "active", "paused"].includes(m.status);
  const flagged = data.attempts.filter((a) => a.status === "needs_review");

  return (
    <Section
      title="Automatic repayment"
      description="A bank direct-debit mandate the customer authorised. Installments are debited on their due dates, within the limit they approved."
      action={
        isAdmin && live ? (
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => {
              if (window.confirm("Cancel this customer's automatic repayment? They'll go back to paying installments themselves.")) {
                void call(`/v1/admin/customers/${customerId}/auto-debit`, { method: "DELETE" }, "Automatic repayment cancelled.");
              }
            }}
          >
            Cancel mandate
          </Button>
        ) : undefined
      }
    >
      {!m ? (
        <p className="text-sm text-text-muted">This customer hasn&apos;t set up automatic repayment.</p>
      ) : (
        <div className="grid gap-x-8 sm:grid-cols-2">
          <div>
            <Row label="Status" value={<Badge tone={MANDATE_TONE[m.status]}>{m.status.replace("_", " ")}</Badge>} />
            <Row label="Reason" value={m.statusReason} />
            <Row label="Valid until" value={formatDate(m.endDate)} />
          </div>
          <div>
            <Row label="Limit approved" value={formatNaira(m.amountKobo)} />
            <Row label="Collected so far" value={formatNaira(m.collectedKobo)} />
            <Row label="Ready to debit" value={m.readyAt ? formatDateTime(m.readyAt) : null} />
          </div>
        </div>
      )}

      {flagged.length > 0 && (
        <p className="mt-3 rounded-[var(--radius-sm)] bg-error/10 px-3 py-2 text-sm text-error">
          {flagged.length} debit{flagged.length === 1 ? "" : "s"} need{flagged.length === 1 ? "s" : ""} a manual check. Automatic debiting is held for
          {flagged.length === 1 ? " that installment" : " those installments"} until {flagged.length === 1 ? "it's" : "they're"} resolved.
        </p>
      )}

      {data.attempts.length > 0 && (
        <div className="mt-4">
          <DataTable head={["When", "Installment", "Amount", "Result", "Detail", ""]}>
            {data.attempts.map((a) => (
              <tr key={a.id}>
                <Td className="whitespace-nowrap text-text-medium">{formatDateTime(a.completedAt ?? a.createdAt)}</Td>
                <Td className="text-text-dark">
                  {a.installmentNumber} of {a.totalInstallments}
                  {a.attemptNumber > 1 && <span className="text-text-muted"> · try {a.attemptNumber}</span>}
                </Td>
                <Td className="whitespace-nowrap tabular-nums text-text-dark">{formatNaira(a.amountKobo)}</Td>
                <Td>
                  <Badge tone={ATTEMPT_TONE[a.status]}>{ATTEMPT_LABEL[a.status]}</Badge>
                </Td>
                <Td className="max-w-[300px] text-xs text-text-muted">
                  {a.failureReason ?? ""}
                  {a.responseCode && a.responseCode !== "00" && a.responseCode !== "RL" ? ` (code ${a.responseCode})` : ""}
                </Td>
                <Td>
                  {isAdmin && a.status === "needs_review" && (
                    <Button
                      variant="ghost"
                      className="!px-2 !py-1 text-xs"
                      disabled={busy}
                      onClick={() => {
                        const noteText = window.prompt("What was done? (e.g. refunded ₦X on 24 Sept, or confirmed with Mono it never processed)");
                        if (noteText && noteText.trim().length >= 3) {
                          void call(
                            `/v1/admin/auto-debit/attempts/${a.id}/resolve`,
                            { method: "POST", body: JSON.stringify({ note: noteText.trim() }) },
                            "Marked as resolved.",
                          );
                        }
                      }}
                    >
                      Mark resolved
                    </Button>
                  )}
                </Td>
              </tr>
            ))}
          </DataTable>
        </div>
      )}
      {note && <p className={`mt-2 text-xs ${note.tone === "ok" ? "text-primary" : "text-error"}`}>{note.text}</p>}
    </Section>
  );
}
