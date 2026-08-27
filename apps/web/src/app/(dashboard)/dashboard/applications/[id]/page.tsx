"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { apiFetch, getToken } from "../../../../../lib/auth";
import { formatNaira, formatDateTime } from "../../../../../lib/format";
import { Card } from "../../../../../components/ui/Card";
import { StatusBadge } from "../../../../../components/ui/Badge";
import { Button } from "../../../../../components/ui/Button";
import { Input, Textarea } from "../../../../../components/ui/Field";

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

const DECIDED_STATUSES = new Set(["approved", "declined"]);

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-wide text-text-muted">{label}</dt>
      <dd className="mt-1 text-sm text-text-dark">{value}</dd>
    </div>
  );
}

// The manual underwriting gate a bank actually has: identity, employment,
// and documents each get their own confirmation before Approve is even
// selectable — not automated (no Mono/FirstCentral yet, §9), but a real,
// persisted checklist, not a UI-only formality.
function VerificationChecklist({
  app,
  onChange,
}: {
  app: ApplicationDetail;
  onChange: (updates: Partial<Pick<ApplicationDetail, "identityVerified" | "employerVerified" | "documentsVerified">>) => void;
}) {
  const items: Array<{ key: "identityVerified" | "employerVerified" | "documentsVerified"; label: string }> = [
    { key: "identityVerified", label: "Identity confirmed" },
    { key: "employerVerified", label: "Employment verified" },
    { key: "documentsVerified", label: "Documents reviewed" },
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
      <h2 className="text-sm font-semibold text-text-dark">Verification checklist</h2>
      <p className="mt-1 text-xs text-text-muted">All three are required before this can be approved.</p>
      <div className="mt-4 flex flex-col gap-3">
        {items.map(({ key, label }) => {
          const checked = app[key];
          return (
            <label key={key} className="flex cursor-pointer items-center gap-3">
              {/* A real checkbox, not a styled <span onClick> — that had no
                  accessible role at all, so it was neither keyboard-operable
                  nor announced by a screen reader as a control, and (found
                  while testing this live) wasn't reliably clickable either. */}
              <input
                type="checkbox"
                checked={checked}
                onChange={(e) => toggle(key, e.target.checked)}
                className="h-4 w-4 accent-primary"
              />
              <span className="text-sm text-text-dark">{label}</span>
            </label>
          );
        })}
      </div>
    </Card>
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
      <h2 className="text-sm font-semibold text-text-dark">Decide this application</h2>
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
          {submitting ? "Submitting…" : "Submit decision"}
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
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
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

          <Card className="p-6">
            <dl className="grid grid-cols-3 gap-6">
              <Field label="Full name" value={app.fullName} />
              <Field label="Phone" value={app.phone} />
              <Field label="Email" value={app.email ?? "—"} />
              <Field label="Employer" value={app.employer ?? "—"} />
              <Field label="Employment type" value={app.employmentType ?? "—"} />
              <Field label="Job title" value={app.jobTitle ?? "—"} />
              <Field label="Net monthly salary" value={formatNaira(app.netMonthlySalaryKobo)} />
              <Field label="Requested limit" value={formatNaira(app.requestedLimitKobo)} />
              <Field label="Submitted" value={formatDateTime(app.submittedAt)} />
            </dl>
          </Card>

          {DECIDED_STATUSES.has(app.status) ? (
            <Card className="p-5">
              <p className="text-sm text-text-medium">
                This application has already been decided — status: <StatusBadge status={app.status} />
              </p>
            </Card>
          ) : (
            <div className="grid grid-cols-2 gap-6 items-start">
              <VerificationChecklist app={app} onChange={(updates) => setApp({ ...app, ...updates })} />
              <DecisionPanel app={app} canApprove={canApprove} onDecided={load} />
            </div>
          )}
        </>
      )}
    </div>
  );
}
