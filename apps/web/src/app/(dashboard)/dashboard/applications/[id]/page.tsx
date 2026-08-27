"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { apiFetch, getToken } from "../../../../../lib/auth";

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
}

const DECIDED_STATUSES = new Set(["approved", "declined"]);

function formatNaira(kobo: string | null): string {
  if (kobo === null) return "—";
  return new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN" }).format(
    Number(kobo) / 100,
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-text-muted">{label}</dt>
      <dd className="mt-1 text-text-dark">{value}</dd>
    </div>
  );
}

// Stand-in for the real review workspace (§11.4) — evidence tabs, score
// gauge, reason-code picker. This is the minimum that closes the loop:
// an admin can actually decide, and approving really activates a limit.
function DecisionPanel({ app, onDecided }: { app: ApplicationDetail; onDecided: () => void }) {
  const [outcome, setOutcome] = useState<"approved" | "declined" | "referred">("approved");
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
    <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-4 rounded-lg border border-dark-border p-6">
      <h2 className="font-semibold text-text-dark">Decide this application</h2>
      <div className="flex gap-2">
        {(["approved", "declined", "referred"] as const).map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => setOutcome(option)}
            className={`rounded-md px-3 py-1.5 text-sm font-medium capitalize ${
              outcome === option
                ? "bg-primary text-white"
                : "bg-primary-surface text-text-dark"
            }`}
          >
            {option}
          </button>
        ))}
      </div>

      {outcome === "approved" && (
        <input
          type="number"
          placeholder="Approved limit, ₦"
          value={approvedLimitNaira}
          onChange={(e) => setApprovedLimitNaira(e.target.value)}
          className="rounded-md border border-dark-border px-3 py-2"
          min={1}
          required
        />
      )}

      {outcome === "declined" && (
        <input
          placeholder="Reason codes, comma-separated (required)"
          value={reasonCodes}
          onChange={(e) => setReasonCodes(e.target.value)}
          className="rounded-md border border-dark-border px-3 py-2"
          required
        />
      )}

      <textarea
        placeholder="Notes (optional)"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        className="rounded-md border border-dark-border px-3 py-2"
        rows={2}
      />

      {error && <p className="text-sm text-error">{error}</p>}

      <button
        type="submit"
        disabled={submitting}
        className="self-start rounded-md bg-primary px-4 py-2 font-semibold text-white disabled:opacity-50"
      >
        {submitting ? "Submitting…" : "Submit decision"}
      </button>
    </form>
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
  }, [params.id, router]);

  return (
    <main className="mx-auto max-w-2xl p-8">
      <Link href="/dashboard" className="text-sm text-primary">
        ← Back to applications
      </Link>

      {error && <p className="mt-4 text-sm text-error">{error}</p>}
      {!error && !app && <p className="mt-4 text-text-medium">Loading…</p>}

      {app && (
        <>
          <div className="mt-4 flex items-center justify-between">
            <h1 className="text-2xl font-bold text-text-dark">{app.reference}</h1>
            <span className="rounded-full bg-primary-surface px-3 py-1 text-sm font-medium capitalize text-primary">
              {app.status.replace(/_/g, " ")}
            </span>
          </div>

          <dl className="mt-6 grid grid-cols-2 gap-6 rounded-lg border border-dark-border p-6">
            <Field label="Full name" value={app.fullName} />
            <Field label="Phone" value={app.phone} />
            <Field label="Email" value={app.email ?? "—"} />
            <Field label="Channel" value={app.channel} />
            <Field label="Employer" value={app.employer ?? "—"} />
            <Field label="Employment type" value={app.employmentType ?? "—"} />
            <Field label="Job title" value={app.jobTitle ?? "—"} />
            <Field label="Salary day" value={app.salaryDay ?? "—"} />
            <Field label="Net monthly salary" value={formatNaira(app.netMonthlySalaryKobo)} />
            <Field label="Requested limit" value={formatNaira(app.requestedLimitKobo)} />
            <Field label="Submitted" value={app.submittedAt ? new Date(app.submittedAt).toLocaleString() : "—"} />
            <Field label="Created" value={new Date(app.createdAt).toLocaleString()} />
          </dl>

          {DECIDED_STATUSES.has(app.status) ? (
            <p className="mt-6 text-sm text-text-medium">
              This application has already been decided ({app.status}).
            </p>
          ) : (
            <DecisionPanel app={app} onDecided={load} />
          )}
        </>
      )}
    </main>
  );
}
