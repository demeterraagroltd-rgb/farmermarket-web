"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { apiFetch, getToken } from "../../../lib/auth";
import { formatNaira, formatDateTime } from "../../../lib/format";
import { PageHeader, Card, EmptyState } from "../../../components/ui/Card";
import { StatCard } from "../../../components/ui/StatCard";
import { StatusBadge } from "../../../components/ui/Badge";

interface Application {
  id: string;
  reference: string;
  fullName: string;
  phone: string;
  employer: string | null;
  status: string;
  requestedLimitKobo: string;
  createdAt: string;
}

const PENDING_STATUSES = new Set(["submitted", "auto_checks", "info_required", "credit_review", "escalated"]);

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}

type Filter = "all" | "pending" | "active" | "declined";

const FILTERS: Array<{ id: Filter; label: string }> = [
  { id: "all", label: "All" },
  { id: "pending", label: "Awaiting decision" },
  { id: "active", label: "Active" },
  { id: "declined", label: "Declined" },
];

// Stand-in for the real review workspace (§11.4) — saved views, SLA clock,
// bulk assign. This is a real client-side filter over what's already
// fetched (not a saved view, but genuinely functional), with the summary
// (queue depth, pending count) surfaced above the raw table.
export default function DashboardOverview() {
  const router = useRouter();
  const [applications, setApplications] = useState<Application[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");

  useEffect(() => {
    if (!getToken()) {
      router.push("/login");
      return;
    }
    apiFetch("/v1/admin/applications")
      .then(async (res) => {
        if (res.status === 401) {
          router.push("/login");
          return;
        }
        const body = await res.json();
        if (!res.ok) throw new Error(body.message ?? "Failed to load applications");
        setApplications(body);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load applications"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stats = useMemo(() => {
    if (!applications) return null;
    return {
      total: applications.length,
      pending: applications.filter((a) => PENDING_STATUSES.has(a.status)).length,
      active: applications.filter((a) => a.status === "limit_active").length,
    };
  }, [applications]);

  const filtered = useMemo(() => {
    if (!applications) return [];
    if (filter === "all") return applications;
    if (filter === "pending") return applications.filter((a) => PENDING_STATUSES.has(a.status));
    if (filter === "active") return applications.filter((a) => a.status === "limit_active");
    return applications.filter((a) => a.status === "declined" || a.status === "auto_declined");
  }, [applications, filter]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Applications"
        description="Every submission from the public application form, newest first."
      />

      {error && <p className="text-sm text-error">{error}</p>}

      {stats && (
        <div className="grid grid-cols-3 gap-4">
          <StatCard label="Total applications" value={stats.total} />
          <StatCard label="Awaiting a decision" value={stats.pending} tone={stats.pending > 0 ? "warning" : "default"} />
          <StatCard label="Active credit limits" value={stats.active} tone="success" />
        </div>
      )}

      {applications && applications.length > 0 && (
        <div className="flex gap-1.5">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
                filter === f.id ? "bg-primary text-white" : "bg-primary-surface text-text-medium hover:bg-primary-surface/70"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      )}

      {applications?.length === 0 && <EmptyState label="No applications submitted yet." />}
      {applications && applications.length > 0 && filtered.length === 0 && (
        <EmptyState label="Nothing in this filter." />
      )}

      {filtered.length > 0 && (
        <Card className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-dark-border/60 text-xs font-semibold uppercase tracking-wide text-text-muted">
                <th className="px-5 py-3">Applicant</th>
                <th className="px-5 py-3">Reference</th>
                <th className="px-5 py-3">Employer</th>
                <th className="px-5 py-3">Requested</th>
                <th className="px-5 py-3">Status</th>
                <th className="px-5 py-3">Submitted</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((app) => (
                <tr key={app.id} className="border-b border-dark-border/40 last:border-0 hover:bg-surface">
                  <td className="px-5 py-3">
                    <Link href={`/dashboard/applications/${app.id}`} className="flex items-center gap-3">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary-surface text-xs font-bold text-primary-dark">
                        {initials(app.fullName)}
                      </div>
                      <div className="min-w-0">
                        <p className="truncate font-medium text-text-dark hover:text-primary">{app.fullName}</p>
                        <p className="truncate text-xs text-text-muted">{app.phone}</p>
                      </div>
                    </Link>
                  </td>
                  <td className="px-5 py-3">
                    <Link href={`/dashboard/applications/${app.id}`} className="font-semibold text-primary hover:underline">
                      {app.reference}
                    </Link>
                  </td>
                  <td className="px-5 py-3 text-text-medium">{app.employer ?? "—"}</td>
                  <td className="px-5 py-3 tabular-nums text-text-dark">{formatNaira(app.requestedLimitKobo)}</td>
                  <td className="px-5 py-3">
                    <StatusBadge status={app.status} />
                  </td>
                  <td className="px-5 py-3 text-text-medium">{formatDateTime(app.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
