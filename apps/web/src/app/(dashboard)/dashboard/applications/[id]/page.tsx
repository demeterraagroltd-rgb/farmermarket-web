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

export default function ApplicationDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const [app, setApp] = useState<ApplicationDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!getToken()) {
      router.push("/login");
      return;
    }
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
        </>
      )}
    </main>
  );
}
