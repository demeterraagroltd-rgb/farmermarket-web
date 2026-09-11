"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, getRole, getToken, type StaffRole } from "../../../../lib/auth";
import { Card, PageHeader } from "../../../../components/ui/Card";
import { StatCard } from "../../../../components/ui/StatCard";
import { Badge } from "../../../../components/ui/Badge";
import { BarChart, RingGauge } from "../../../../components/ui/Charts";

interface Overview {
  totalApplicants: number;
  applicationsByDay: Array<{ label: string; date: string; count: number }>;
  approvalRate: { decided: number; approved: number; rate: number | null; windowDays: number };
  operations: { queueDepth: number; avgDecisionHours: number | null };
  portfolio: {
    outstanding: number;
    limitsIssued: number;
    utilisation: number | null;
    par30: number;
    par30Rate: number | null;
  };
  activeLimits: number;
}

const NGN = new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", maximumFractionDigits: 0 });

const ROLE_GREETING: Record<StaffRole, string> = {
  super_admin: "Here's how the whole operation looks today.",
  admin: "Orders, arrears and stock — the operational view.",
  credit: "Your queue, decision speed, and approval trend.",
  sales: "Your pipeline and conversion — preview, not live yet.",
};

export default function OverviewPage() {
  const router = useRouter();
  const [role, setRole] = useState<StaffRole | null>(null);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!getToken()) {
      router.push("/login");
      return;
    }
    const currentRole = getRole();
    setRole(currentRole);
    if (currentRole === "sales") return;

    apiFetch("/v1/admin/reports/overview")
      .then(async (res) => {
        if (res.status === 401) {
          router.push("/login");
          return;
        }
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message ?? "Failed to load");
        setOverview(await res.json());
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pct = (v: number | null | undefined) => (v == null ? "—" : `${Math.round(v * 100)}%`);

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
          <StatCard label="Total applicants" value={overview?.totalApplicants ?? "—"} />
          <StatCard
            label="Awaiting a decision"
            value={overview?.operations.queueDepth ?? "—"}
            tone={(overview?.operations.queueDepth ?? 0) > 0 ? "warning" : "default"}
          />
          <StatCard label="Active credit limits" value={overview?.activeLimits ?? "—"} tone="success" />
        </div>
      )}

      <div className="grid grid-cols-3 gap-6">
        <Card className="col-span-2 p-5">
          <h2 className="text-sm font-semibold text-text-dark">Applications this week</h2>
          <div className="mt-4">
            <BarChart
              data={(overview?.applicationsByDay ?? []).map((d) => ({ label: d.label, value: d.count }))}
            />
          </div>
        </Card>

        <Card className="p-5">
          <h2 className="text-sm font-semibold text-text-dark">Approval rate</h2>
          <div className="mt-3 flex flex-col items-center justify-center">
            <RingGauge
              value={overview?.approvalRate.rate != null ? Math.round(overview.approvalRate.rate * 100) : 0}
              label={`${overview?.approvalRate.decided ?? 0} decided · ${overview?.approvalRate.windowDays ?? 30}d`}
              color="var(--color-success)"
            />
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-3 gap-6">
        <Card
          className="col-span-2 overflow-hidden p-6 text-white"
          style={{ background: "var(--gradient-credit-card)" }}
        >
          <p className="text-sm font-medium text-white/70">Portfolio outstanding</p>
          <p className="mt-2 text-3xl font-bold tabular-nums">
            {overview ? NGN.format(overview.portfolio.outstanding) : "—"}
          </p>
          <div className="mt-5 flex gap-8">
            <div>
              <p className="text-xs text-white/60">Limits issued</p>
              <p className="text-sm font-semibold tabular-nums">
                {overview ? NGN.format(overview.portfolio.limitsIssued) : "—"}
              </p>
            </div>
            <div>
              <p className="text-xs text-white/60">Utilisation</p>
              <p className="text-sm font-semibold tabular-nums">{pct(overview?.portfolio.utilisation)}</p>
            </div>
            <div>
              <p className="text-xs text-white/60">PAR 30+</p>
              <p className="text-sm font-semibold tabular-nums">{pct(overview?.portfolio.par30Rate)}</p>
            </div>
          </div>
        </Card>

        <Card className="p-5">
          <h2 className="text-sm font-semibold text-text-dark">Operational</h2>
          <div className="mt-4 flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <span className="text-xs text-text-muted">Avg. decision time</span>
              <span className="text-sm font-semibold tabular-nums text-text-dark">
                {overview?.operations.avgDecisionHours != null
                  ? `${overview.operations.avgDecisionHours}h`
                  : "—"}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-text-muted">Queue depth</span>
              <span className="text-sm font-semibold tabular-nums text-text-dark">
                {overview?.operations.queueDepth ?? "—"}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-text-muted">Overdue exposure (30+)</span>
              <Badge tone={(overview?.portfolio.par30 ?? 0) > 0 ? "warning" : "success"}>
                {overview ? NGN.format(overview.portfolio.par30) : "—"}
              </Badge>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
