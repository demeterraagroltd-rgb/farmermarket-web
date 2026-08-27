"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, getRole, getToken, type StaffRole } from "../../../../lib/auth";
import { Card, PageHeader, PreviewTag } from "../../../../components/ui/Card";
import { StatCard } from "../../../../components/ui/StatCard";
import { Badge } from "../../../../components/ui/Badge";
import { BarChart, RingGauge } from "../../../../components/ui/Charts";

interface Application {
  id: string;
  status: string;
  requestedLimitKobo: string;
}

const PENDING_STATUSES = new Set(["submitted", "auto_checks", "info_required", "credit_review", "escalated"]);

// Mock, deliberately — there's no origination-funnel or approval-analytics
// query built yet (§12 lists both as future reports). This is here to show
// what the finished Overview is meant to look like once those exist, not
// to pass as live numbers — see PreviewTag on every section that uses it.
const MOCK_WEEKLY_VOLUME = [
  { label: "Mon", value: 4 },
  { label: "Tue", value: 7 },
  { label: "Wed", value: 5 },
  { label: "Thu", value: 9 },
  { label: "Fri", value: 6 },
  { label: "Sat", value: 2 },
  { label: "Sun", value: 1 },
];

const ROLE_GREETING: Record<StaffRole, string> = {
  super_admin: "Here's how the whole operation looks today.",
  admin: "Orders, arrears and stock — the operational view.",
  credit: "Your queue, decision speed, and approval trend.",
  sales: "Your pipeline and conversion — preview, not live yet.",
};

export default function OverviewPage() {
  const router = useRouter();
  const [role, setRole] = useState<StaffRole | null>(null);
  const [applications, setApplications] = useState<Application[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!getToken()) {
      router.push("/login");
      return;
    }
    const currentRole = getRole();
    setRole(currentRole);

    // Sales has no admin-scoped endpoint yet (AdminApplicationsController
    // is super_admin/admin/credit only) — skip the fetch rather than let
    // it 403, and render the preview-only view below instead.
    if (currentRole === "sales") return;

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
    const pending = applications.filter((a) => PENDING_STATUSES.has(a.status)).length;
    const active = applications.filter((a) => a.status === "limit_active").length;
    const totalRequestedKobo = applications.reduce((sum, a) => sum + Number(a.requestedLimitKobo), 0);
    return { total: applications.length, pending, active, totalRequestedKobo };
  }, [applications]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Overview"
        description={role ? ROLE_GREETING[role] : "A snapshot of what's happening across Farmer Market."}
      />

      {error && <p className="text-sm text-error">{error}</p>}

      {role === "sales" ? (
        <Card className="p-8 text-center">
          <p className="text-sm text-text-medium">
            Sales pipeline tracking isn&apos;t built yet — applications are currently only submitted
            through the public web form, not sales-assisted. This is where your own pipeline,
            conversion rate and average approved limit will live once that exists (§11.4).
          </p>
        </Card>
      ) : (
        <div className="grid grid-cols-3 gap-4">
          <StatCard label="Total applications" value={stats?.total ?? "—"} />
          <StatCard
            label="Awaiting a decision"
            value={stats?.pending ?? "—"}
            tone={stats && stats.pending > 0 ? "warning" : "default"}
          />
          <StatCard label="Active credit limits" value={stats?.active ?? "—"} tone="success" />
        </div>
      )}

      {/* Everything below is representative — the aspired-to finished
          Overview (§11.4, §12), built with sample numbers because the
          underlying reports don't exist yet. Every section says so. */}
      <div className="grid grid-cols-3 gap-6">
        <Card className="col-span-2 p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-text-dark">Applications this week</h2>
            <PreviewTag />
          </div>
          <div className="mt-4">
            <BarChart data={MOCK_WEEKLY_VOLUME} />
          </div>
        </Card>

        <Card className="p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-text-dark">Approval rate</h2>
            <PreviewTag />
          </div>
          <div className="mt-3 flex items-center justify-center">
            <RingGauge value={72} label="last 30 days" color="var(--color-success)" />
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-3 gap-6">
        <Card className="col-span-2 overflow-hidden p-6 text-white" style={{ background: "var(--gradient-credit-card)" }}>
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-white/70">Portfolio outstanding</p>
            <PreviewTag />
          </div>
          <p className="mt-2 text-3xl font-bold tabular-nums">₦4,280,000</p>
          <div className="mt-5 flex gap-8">
            <div>
              <p className="text-xs text-white/60">Limits issued</p>
              <p className="text-sm font-semibold tabular-nums">₦6,150,000</p>
            </div>
            <div>
              <p className="text-xs text-white/60">Utilization</p>
              <p className="text-sm font-semibold tabular-nums">70%</p>
            </div>
            <div>
              <p className="text-xs text-white/60">PAR 30+</p>
              <p className="text-sm font-semibold tabular-nums">2.1%</p>
            </div>
          </div>
        </Card>

        <Card className="p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-text-dark">Operational</h2>
            <PreviewTag />
          </div>
          <div className="mt-4 flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <span className="text-xs text-text-muted">SLA breaches</span>
              <Badge tone="warning">3</Badge>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-text-muted">Avg. decision time</span>
              <span className="text-sm font-semibold tabular-nums text-text-dark">6.4h</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-text-muted">Queue depth</span>
              <span className="text-sm font-semibold tabular-nums text-text-dark">{stats?.pending ?? "—"}</span>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
