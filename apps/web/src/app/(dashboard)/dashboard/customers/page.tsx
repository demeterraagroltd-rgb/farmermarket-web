"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, getToken } from "../../../../lib/auth";
import { formatNaira, formatDate } from "../../../../lib/format";
import { PageHeader, Card, EmptyState } from "../../../../components/ui/Card";
import { Badge } from "../../../../components/ui/Badge";
import { StatCard } from "../../../../components/ui/StatCard";

interface Customer {
  id: string;
  phone: string;
  fullName: string | null;
  email: string | null;
  createdAt: string;
  creditLimitKobo: string | null;
  usedCreditKobo: string | null;
  tier: string | null;
  isVerified: boolean | null;
}

function initials(name: string | null, phone: string): string {
  if (!name) return phone.slice(-2);
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}

// Real, not decorative — utilization is used/limit from the same
// credit_profiles row the phone app reads (§5.3). A bar reads faster than
// two separate naira figures when you're scanning a list of customers.
function UtilizationBar({ used, limit }: { used: number; limit: number }) {
  const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  const color = pct >= 90 ? "bg-error" : pct >= 70 ? "bg-warning" : "bg-primary";
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-surface">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="w-8 text-right text-xs tabular-nums text-text-muted">{pct}%</span>
    </div>
  );
}

// Stand-in for the real 360° customer view (§11.4) — order history,
// repayment behaviour, notes, all applications. This is "who has an
// account, and what's their credit limit right now" — the actual output
// of the apply → decide → activate loop.
export default function CustomersPage() {
  const router = useRouter();
  const [customers, setCustomers] = useState<Customer[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!getToken()) {
      router.push("/login");
      return;
    }
    apiFetch("/v1/admin/customers")
      .then(async (res) => {
        if (res.status === 401) {
          router.push("/login");
          return;
        }
        const body = await res.json();
        if (!res.ok) throw new Error(body.message ?? "Failed to load customers");
        setCustomers(body);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load customers"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stats = useMemo(() => {
    if (!customers) return null;
    const withLimit = customers.filter((c) => Number(c.creditLimitKobo ?? 0) > 0);
    const totalOutstandingKobo = customers.reduce((sum, c) => sum + Number(c.usedCreditKobo ?? 0), 0);
    return { total: customers.length, withLimit: withLimit.length, totalOutstandingKobo };
  }, [customers]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Customers"
        description="Everyone who's applied, with their current credit limit if they have one."
      />

      {error && <p className="text-sm text-error">{error}</p>}

      {stats && (
        <div className="grid grid-cols-3 gap-4">
          <StatCard label="Total customers" value={stats.total} />
          <StatCard label="With an active limit" value={stats.withLimit} tone="success" />
          <StatCard label="Total outstanding" value={formatNaira(stats.totalOutstandingKobo)} />
        </div>
      )}

      {customers?.length === 0 && <EmptyState label="No customers yet." />}

      {customers && customers.length > 0 && (
        <Card className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-dark-border/60 text-xs font-semibold uppercase tracking-wide text-text-muted">
                <th className="px-5 py-3">Customer</th>
                <th className="px-5 py-3">Credit limit</th>
                <th className="px-5 py-3">Utilization</th>
                <th className="px-5 py-3">Tier</th>
                <th className="px-5 py-3">Joined</th>
              </tr>
            </thead>
            <tbody>
              {customers.map((c) => (
                <tr key={c.id} className="border-b border-dark-border/40 last:border-0 hover:bg-surface">
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-3">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary-surface text-xs font-bold text-primary-dark">
                        {initials(c.fullName, c.phone)}
                      </div>
                      <div className="min-w-0">
                        <p className="truncate font-medium text-text-dark">{c.fullName ?? "—"}</p>
                        <p className="truncate text-xs text-text-muted">{c.phone}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-5 py-3 tabular-nums text-text-dark">{formatNaira(c.creditLimitKobo)}</td>
                  <td className="px-5 py-3">
                    {c.creditLimitKobo ? (
                      <UtilizationBar used={Number(c.usedCreditKobo ?? 0)} limit={Number(c.creditLimitKobo)} />
                    ) : (
                      <span className="text-xs text-text-muted">No limit yet</span>
                    )}
                  </td>
                  <td className="px-5 py-3">
                    {c.tier ? <Badge tone="gold">{c.tier}</Badge> : <span className="text-text-muted">—</span>}
                  </td>
                  <td className="px-5 py-3 text-text-medium">{formatDate(c.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
