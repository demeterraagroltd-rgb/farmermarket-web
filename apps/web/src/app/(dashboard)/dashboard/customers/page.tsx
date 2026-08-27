"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, getToken } from "../../../../lib/auth";
import { formatNaira, formatDate } from "../../../../lib/format";
import { PageHeader, Card, EmptyState } from "../../../../components/ui/Card";
import { Badge } from "../../../../components/ui/Badge";

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

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Customers"
        description="Everyone who's applied, with their current credit limit if they have one."
      />

      {error && <p className="text-sm text-error">{error}</p>}
      {customers?.length === 0 && <EmptyState label="No customers yet." />}

      {customers && customers.length > 0 && (
        <Card className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-dark-border/60 text-xs font-semibold uppercase tracking-wide text-text-muted">
                <th className="px-5 py-3">Name</th>
                <th className="px-5 py-3">Phone</th>
                <th className="px-5 py-3">Credit limit</th>
                <th className="px-5 py-3">Used</th>
                <th className="px-5 py-3">Tier</th>
                <th className="px-5 py-3">Joined</th>
              </tr>
            </thead>
            <tbody>
              {customers.map((c) => (
                <tr key={c.id} className="border-b border-dark-border/40 last:border-0">
                  <td className="px-5 py-3 text-text-dark">{c.fullName ?? "—"}</td>
                  <td className="px-5 py-3 text-text-medium">{c.phone}</td>
                  <td className="px-5 py-3 tabular-nums text-text-dark">{formatNaira(c.creditLimitKobo)}</td>
                  <td className="px-5 py-3 tabular-nums text-text-medium">{formatNaira(c.usedCreditKobo)}</td>
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
