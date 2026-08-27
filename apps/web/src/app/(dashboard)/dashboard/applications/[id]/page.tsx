"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { apiFetch, getToken } from "../../../../../lib/auth";
import { formatNaira, formatDateTime } from "../../../../../lib/format";
import { Card, EmptyState } from "../../../../../components/ui/Card";
import { StatusBadge, Badge } from "../../../../../components/ui/Badge";
import { Button } from "../../../../../components/ui/Button";
import { Input, Textarea } from "../../../../../components/ui/Field";
import { Tabs } from "../../../../../components/ui/Tabs";
import { CheckIcon, DocumentIcon } from "../../../../../components/ui/icons";

interface ApplicationDetail {
  id: string;
  reference: string;
  status: string;
  channel: string;
  fullName: string;
  phone: string;
  email: string | null;
  employer: string | null;
  employmentType: string | null;
  jobTitle: string | null;
  netMonthlySalaryKobo: string | null;
  requestedLimitKobo: string;
  salaryDay: number | null;
  createdAt: string;
  submittedAt: string | null;
  identityVerified: boolean;
  employerVerified: boolean;
  documentsVerified: boolean;
}

interface ApplicationEvent {
  id: string;
  fromStatus: string | null;
  toStatus: string;
  reason: string | null;
  createdAt: string;
  actorName: string | null;
}

// "limit_active" belongs here too — decide() moves an approved application
// straight to it (§ApplicationsService.decide), so without it a fully
// activated application still rendered the decision form as if pending.
const DECIDED_STATUSES = new Set(["approved", "declined", "limit_active"]);

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-wide text-text-muted">{label}</dt>
      <dd className="mt-1 text-sm text-text-dark">{value}</dd>
    </div>
  );
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}

// Left column, top card — who this is, at a glance. The exhaustive field
// list lives in the Overview tab in the centre; this is deliberately just
// enough to orient a reviewer before they read anything else.
function ApplicantCard({ app }: { app: ApplicationDetail }) {
  return (
    <Card className="p-5">
      <div className="flex items-center gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary-surface text-sm font-bold text-primary-dark">
          {initials(app.fullName)}
        </div>
        <div className="min-w-0">
          <p className="truncate font-semibold text-text-dark">{app.fullName}</p>
          <p className="truncate text-xs text-text-muted">
            {[app.jobTitle, app.employer].filter(Boolean).join(" · ") || "No employer on file"}
          </p>
        </div>
      </div>

      <dl className="mt-5 flex flex-col gap-3 border-t border-dark-border/60 pt-4">
        <div className="flex items-center justify-between">
          <dt className="text-xs text-text-muted">Requested amount</dt>
          <dd className="text-sm font-semibold tabular-nums text-text-dark">
            {formatNaira(app.requestedLimitKobo)}
          </dd>
        </div>
        <div className="flex items-center justify-between">
          <dt className="text-xs text-text-muted">Monthly salary</dt>
          <dd className="text-sm tabular-nums text-text-dark">
            {formatNaira(app.netMonthlySalaryKobo)}
          </dd>
        </div>
        <div className="flex items-center justify-between">
          <dt className="text-xs text-text-muted">Submitted</dt>
          <dd className="text-sm text-text-dark">{formatDateTime(app.submittedAt)}</dd>
        </div>
      </dl>
    </Card>
  );
}

// The manual underwriting gate a bank actually has: identity, employment,
// and documents each get their own confirmation before Approve is even
// selectable — not automated (no Mono/FirstCentral yet, §9), but a real,
// persisted checklist, not a UI-only formality. Styled as a document list
// since that's conceptually what it stands in for, though today it's one
// boolean per category rather than per uploaded file.
function DocumentsCard({
  app,
  onChange,
}: {
  app: ApplicationDetail;
  onChange: (updates: Partial<Pick<ApplicationDetail, "identityVerified" | "employerVerified" | "documentsVerified">>) => void;
}) {
  const items: Array<{ key: "identityVerified" | "employerVerified" | "documentsVerified"; label: string }> = [
    { key: "identityVerified", label: "Identity" },
    { key: "employerVerified", label: "Employment" },
    { key: "documentsVerified", label: "Documents" },
  ];

  async function toggle(key: (typeof items)[number]["key"], next: boolean) {
    onChange({ [key]: next });
    await apiFetch(`/v1/admin/applications/${app.id}/verification`, {
      method: "PATCH",
      body: JSON.stringify({ [key]: next }),
    });
  }

  return (
    <Card className="p-5">
      <h2 className="text-sm font-semibold text-text-dark">Verification</h2>
      <p className="mt-1 text-xs text-text-muted">All three are required before this can be approved.</p>
      <div className="mt-4 flex flex-col gap-1">
        {items.map(({ key, label }) => {
          const checked = app[key];
          return (
            <label
              key={key}
              className="flex cursor-pointer items-center gap-3 rounded-[var(--radius-sm)] px-2 py-2 hover:bg-surface"
            >
              <DocumentIcon className="h-4 w-4 shrink-0 text-text-muted" />
              <span className="flex-1 text-sm text-text-dark">{label}</span>
              {/* A real checkbox, not a styled <span onClick> — that had no
                  accessible role at all, so it was neither keyboard-operable
                  nor announced by a screen reader as a control. */}
              <input
                type="checkbox"
                checked={checked}
                onChange={(e) => toggle(key, e.target.checked)}
                className="h-4 w-4 accent-primary"
              />
            </label>
          );
        })}
      </div>
    </Card>
  );
}

const EVENT_LABEL: Record<string, string> = {
  submitted: "Application submitted",
  auto_checks: "Automated checks completed",
  info_required: "More information requested",
  credit_review: "Sent for credit review",
  escalated: "Escalated",
  approved: "Approved",
  declined: "Declined",
  limit_active: "Credit limit activated",
};

// Real data, not a mock timeline — reads `application_events`, the same
// table the SLA clock and audit trail read from (§7). The submission event
// itself isn't written there today (create() doesn't insert one), so it's
// synthesized from `submittedAt`/`createdAt` as the timeline's origin point.
function ActivityCard({ app }: { app: ApplicationDetail }) {
  const [events, setEvents] = useState<ApplicationEvent[] | null>(null);

  useEffect(() => {
    apiFetch(`/v1/admin/applications/${app.id}/events`)
      .then((res) => (res.ok ? res.json() : []))
      .then(setEvents)
      .catch(() => setEvents([]));
  }, [app.id]);

  const submittedEntry = {
    label: EVENT_LABEL.submitted,
    at: app.submittedAt ?? app.createdAt,
    by: null as string | null,
  };
  const decisionEntries = (events ?? []).map((e) => ({
    label: EVENT_LABEL[e.toStatus] ?? e.toStatus.replace(/_/g, " "),
    at: e.createdAt,
    by: e.actorName,
  }));
  // Newest first, submission always last since it's the origin.
  const timeline = [...decisionEntries].reverse().concat(submittedEntry);

  return (
    <Card className="p-5">
      <h2 className="text-sm font-semibold text-text-dark">Activity</h2>
      {events === null ? (
        <p className="mt-3 text-xs text-text-muted">Loading…</p>
      ) : (
        <ol className="mt-4 flex flex-col gap-4">
          {timeline.map((entry, i) => (
            <li key={i} className="flex gap-3">
              <div className="flex flex-col items-center pt-1">
                <span
                  className={`h-2 w-2 shrink-0 rounded-full ${i === 0 ? "bg-primary" : "bg-dark-border"}`}
                />
                {i < timeline.length - 1 && <span className="mt-1 w-px flex-1 bg-dark-border/60" />}
              </div>
              <div className="pb-1">
                <p className="text-sm text-text-dark">{entry.label}</p>
                <p className="text-xs text-text-muted">
                  {formatDateTime(entry.at)}
                  {entry.by ? ` · ${entry.by}` : ""}
                </p>
              </div>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}

// Not a fabricated credit score — a real automated score needs bank
// statement (Mono, §9.1) and bureau (FirstCentral, §9.2) inputs that
// aren't connected yet, and guessing at those would look authoritative
// while being made up. This is the one ratio actually computable from data
// on file today, offered as a rough sanity check, not a verdict.
function AffordabilityCard({ app }: { app: ApplicationDetail }) {
  const salary = app.netMonthlySalaryKobo ? Number(app.netMonthlySalaryKobo) : null;
  const requested = Number(app.requestedLimitKobo);
  const ratio = salary && salary > 0 ? requested / salary : null;

  const band =
    ratio === null
      ? null
      : ratio <= 0.6
        ? { label: "Comfortable", tone: "success" as const }
        : ratio <= 1.2
          ? { label: "Moderate", tone: "warning" as const }
          : { label: "High", tone: "error" as const };

  return (
    <Card className="p-5">
      <h2 className="text-sm font-semibold text-text-dark">Affordability</h2>
      {ratio === null ? (
        <p className="mt-2 text-xs text-text-muted">
          No net monthly salary on file — can&apos;t assess the requested amount against it.
        </p>
      ) : (
        <div className="mt-3 flex items-center justify-between">
          <div>
            <p className="text-2xl font-bold tabular-nums text-text-dark">{Math.round(ratio * 100)}%</p>
            <p className="text-xs text-text-muted">of monthly salary</p>
          </div>
          {band && <Badge tone={band.tone}>{band.label}</Badge>}
        </div>
      )}
      <p className="mt-4 border-t border-dark-border/60 pt-3 text-xs text-text-muted">
        Full automated scoring isn&apos;t available yet — it depends on bank statement and credit
        bureau data that aren&apos;t connected (§9).
      </p>
    </Card>
  );
}

function NotConnected({ title, reason }: { title: string; reason: string }) {
  return (
    <div className="py-10">
      <EmptyState label={`${title} — ${reason}`} />
    </div>
  );
}

function DecisionPanel({
  app,
  canApprove,
  onDecided,
}: {
  app: ApplicationDetail;
  canApprove: boolean;
  onDecided: () => void;
}) {
  const [outcome, setOutcome] = useState<"approved" | "declined" | "referred">(
    canApprove ? "approved" : "referred",
  );
  const [approvedLimitNaira, setApprovedLimitNaira] = useState(
    String(Number(app.requestedLimitKobo) / 100),
  );
  const [reasonCodes, setReasonCodes] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await apiFetch(`/v1/admin/applications/${app.id}/decisions`, {
        method: "POST",
        body: JSON.stringify({
          outcome,
          approvedLimitNaira: outcome === "approved" ? Number(approvedLimitNaira) : undefined,
          reasonCodes:
            outcome === "declined"
              ? reasonCodes.split(",").map((s) => s.trim()).filter(Boolean)
              : undefined,
          notes: notes || undefined,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.message ?? "Decision failed");
      onDecided();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Decision failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card className="p-5">
      <h2 className="text-sm font-semibold text-text-dark">Decision</h2>
      <form onSubmit={handleSubmit} className="mt-4 flex flex-col gap-4">
        <div className="flex gap-2">
          {(
            [
              { value: "approved" as const, label: "Approve", disabled: !canApprove },
              { value: "declined" as const, label: "Decline", disabled: false },
              { value: "referred" as const, label: "Refer", disabled: false },
            ]
          ).map((option) => (
            <button
              key={option.value}
              type="button"
              disabled={option.disabled}
              onClick={() => setOutcome(option.value)}
              title={option.disabled ? "Complete the verification checklist first" : undefined}
              className={`rounded-[var(--radius-sm)] px-3 py-1.5 text-sm font-medium capitalize transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                outcome === option.value ? "bg-primary text-white" : "bg-primary-surface text-text-dark"
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>

        {!canApprove && (
          <p className="text-xs text-warning">
            Complete the verification checklist to enable Approve.
          </p>
        )}

        {outcome === "approved" && (
          <Input
            type="number"
            label="Approved limit, ₦"
            value={approvedLimitNaira}
            onChange={(e) => setApprovedLimitNaira(e.target.value)}
            min={1}
            required
          />
        )}

        {outcome === "declined" && (
          <Input
            label="Reason codes (comma-separated, required)"
            value={reasonCodes}
            onChange={(e) => setReasonCodes(e.target.value)}
            required
          />
        )}

        <Textarea label="Notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />

        {error && <p className="text-sm text-error">{error}</p>}

        <Button type="submit" disabled={submitting} className="self-start">
          {submitting ? (
            "Submitting…"
          ) : (
            <>
              <CheckIcon className="h-4 w-4" />
              Submit decision
            </>
          )}
        </Button>
      </form>
    </Card>
  );
}

export default function ApplicationDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const [app, setApp] = useState<ApplicationDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  function load() {
    apiFetch(`/v1/admin/applications/${params.id}`)
      .then(async (res) => {
        if (res.status === 401) {
          router.push("/login");
          return;
        }
        const body = await res.json();
        if (!res.ok) throw new Error(body.message ?? "Failed to load application");
        setApp(body);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load application"));
  }

  useEffect(() => {
    if (!getToken()) {
      router.push("/login");
      return;
    }
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id]);

  const canApprove = !!(app?.identityVerified && app?.employerVerified && app?.documentsVerified);

  return (
    <div className="flex flex-col gap-6">
      <Link href="/dashboard" className="text-sm font-medium text-primary hover:underline">
        ← Back to applications
      </Link>

      {error && <p className="text-sm text-error">{error}</p>}
      {!error && !app && <p className="text-text-medium">Loading…</p>}

      {app && (
        <>
          <div className="flex items-center justify-between">
            <h1 className="text-2xl font-bold text-text-dark">{app.reference}</h1>
            <StatusBadge status={app.status} />
          </div>

          <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-[300px_1fr_340px]">
            <div className="flex flex-col gap-6">
              <ApplicantCard app={app} />
              <DocumentsCard app={app} onChange={(updates) => setApp({ ...app, ...updates })} />
              <ActivityCard app={app} />
            </div>

            <Card className="overflow-hidden">
              <Tabs
                tabs={[
                  { id: "overview", label: "Overview" },
                  { id: "bank", label: "Bank Analysis" },
                  { id: "bureau", label: "Bureau Report" },
                ]}
              >
                {(tab) =>
                  tab === "overview" ? (
                    <dl className="grid grid-cols-2 gap-6">
                      <Field label="Full name" value={app.fullName} />
                      <Field label="Phone" value={app.phone} />
                      <Field label="Email" value={app.email ?? "—"} />
                      <Field label="Employer" value={app.employer ?? "—"} />
                      <Field label="Employment type" value={app.employmentType ?? "—"} />
                      <Field label="Job title" value={app.jobTitle ?? "—"} />
                      <Field label="Net monthly salary" value={formatNaira(app.netMonthlySalaryKobo)} />
                      <Field label="Requested limit" value={formatNaira(app.requestedLimitKobo)} />
                      <Field label="Salary day" value={app.salaryDay ?? "—"} />
                      <Field label="Channel" value={app.channel} />
                    </dl>
                  ) : tab === "bank" ? (
                    <NotConnected
                      title="Bank statement analysis"
                      reason="requires the Mono open banking integration (§9.1), not connected yet"
                    />
                  ) : (
                    <NotConnected
                      title="Credit bureau report"
                      reason="requires the FirstCentral integration (§9.2), not connected yet"
                    />
                  )
                }
              </Tabs>
            </Card>

            <div className="flex flex-col gap-6">
              <AffordabilityCard app={app} />
              {DECIDED_STATUSES.has(app.status) ? (
                <Card className="p-5">
                  <p className="text-sm text-text-medium">
                    Already decided — status: <StatusBadge status={app.status} />
                  </p>
                </Card>
              ) : (
                <DecisionPanel app={app} canApprove={canApprove} onDecided={load} />
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
