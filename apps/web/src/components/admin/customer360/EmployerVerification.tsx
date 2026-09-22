"use client";

import { Badge } from "../../ui/Badge";
import { formatNaira } from "../../../lib/format";
import type { EmployerCheck } from "../../../lib/customer360";
import { Section } from "./parts";
import { useStoredData } from "./useStoredData";

// Two free, no-integration signals: does the declared employer's name read as
// a placeholder, and does the customer's own bank data actually show that
// employer paying them. Neither confirms the business is registered — that
// needs a paid registry (CAC) lookup, which this deliberately doesn't do — so
// everything here is phrased as something to weigh, not a verdict.

export function EmployerVerification({ customerId }: { customerId: string }) {
  const { data, error } = useStoredData<EmployerCheck>(`/v1/admin/customers/${customerId}/employer-check`);

  if (error && !data) return null; // non-critical; fails quietly rather than breaking the tab
  if (!data) {
    return (
      <Section title="Employer verification">
        <p className="text-sm text-text-muted">Checking…</p>
      </Section>
    );
  }

  if (!data.employer) {
    return (
      <Section title="Employer verification">
        <p className="text-sm text-text-muted">
          {data.employmentType?.toLowerCase() === "self-employed"
            ? "Declared as self-employed — there's no employer name to check."
            : "No employer is declared on this customer's profile."}
        </p>
      </Section>
    );
  }

  const isSelfEmployed = data.employmentType?.toLowerCase() === "self-employed";

  return (
    <Section
      title="Employer verification"
      description="Heuristics only — name-quality and a check against the customer's own bank data. Confirming the business is actually registered isn't done here."
    >
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-text-muted">Declared employer:</span>
          <span className="font-semibold text-text-dark">{data.employer}</span>
          {data.employmentType && <Badge tone="neutral">{data.employmentType}</Badge>}
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-[var(--radius-lg)] border border-dark-border/60 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">Name looks real</p>
            {data.nameCheck?.suspicious ? (
              <>
                <Badge tone="warning">Worth checking</Badge>
                <ul className="mt-1.5 list-inside list-disc text-xs text-text-muted">
                  {data.nameCheck.reasons.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
              </>
            ) : (
              <Badge tone="success">No red flags</Badge>
            )}
          </div>

          <div className="rounded-[var(--radius-lg)] border border-dark-border/60 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">Employer is paying</p>
            {isSelfEmployed ? (
              <Badge tone="neutral">Not applicable</Badge>
            ) : data.payment?.matched ? (
              <>
                <Badge tone="success">Matched</Badge>
                {data.payment.source && (
                  <p className="mt-1.5 text-xs text-text-muted">
                    {data.payment.source.recurring ? "Recurring" : "One-off"} credits totalling {formatNaira(data.payment.source.totalKobo)}, most recently &ldquo;{data.payment.source.label}&rdquo;.
                  </p>
                )}
              </>
            ) : (
              <>
                <Badge tone="warning">No match found</Badge>
                <p className="mt-1.5 text-xs text-text-muted">
                  Nothing in the customer&apos;s last 6 months of stored credits names this employer.
                </p>
              </>
            )}
          </div>

          <div className="rounded-[var(--radius-lg)] border border-dark-border/60 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">Used by other applicants</p>
            {data.sharedWith ? (
              <>
                <Badge tone={data.sharedWith.flagged ? "warning" : "neutral"}>
                  {data.sharedWith.count} other{data.sharedWith.count === 1 ? "" : "s"}
                </Badge>
                {data.sharedWith.flagged && <p className="mt-1.5 text-xs text-text-muted">An unusually common employer name for this many applicants — worth a second look.</p>}
              </>
            ) : (
              <Badge tone="neutral">—</Badge>
            )}
          </div>
        </div>

        <p className="text-xs text-text-muted">
          None of this confirms the business is registered. For that, search{" "}
          <a href="https://search.cac.gov.ng" target="_blank" rel="noopener noreferrer" className="font-medium text-primary hover:underline">
            the CAC public register
          </a>{" "}
          directly.
        </p>
      </div>
    </Section>
  );
}
