"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, getToken } from "../../../../lib/auth";

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

function formatNaira(kobo: string | null): string {
  if (kobo === null) return "—";
  return new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN" }).format(
    Number(kobo) / 100,
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

  return (
    <main className="p-8">
      <h1 className="text-2xl font-bold text-text-dark">Customers</h1>
      <p className="mt-1 text-sm text-text-medium">
        Everyone who's applied, with their current credit limit if they have one.
      </p>

      {error && <p className="mt-4 text-sm text-error">{error}</p>}
      {customers?.length === 0 && <p className="mt-6 text-text-medium">No customers yet.</p>}

      {customers && customers.length > 0 && (
        <div className="mt-6 overflow-x-auto rounded-lg border border-dark-border">
          <table className="w-full text-left text-sm">
            <thead className="bg-primary-surface text-text-dark">
              <tr>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Phone</th>
                <th className="px-4 py-3">Credit limit</th>
                <th className="px-4 py-3">Used</th>
                <th className="px-4 py-3">Tier</th>
                <th className="px-4 py-3">Joined</th>
              </tr>
            </thead>
            <tbody>
              {customers.map((c) => (
                <tr key={c.id} className="border-t border-dark-border">
                  <td className="px-4 py-3">{c.fullName ?? "—"}</td>
                  <td className="px-4 py-3">{c.phone}</td>
                  <td className="px-4 py-3">{formatNaira(c.creditLimitKobo)}</td>
                  <td className="px-4 py-3">{formatNaira(c.usedCreditKobo)}</td>
                  <td className="px-4 py-3">{c.tier ?? "—"}</td>
                  <td className="px-4 py-3">{new Date(c.createdAt).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
