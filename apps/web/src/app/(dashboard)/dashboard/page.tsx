"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { apiFetch, getToken } from "../../../lib/auth";

interface Application {
  id: string;
  reference: string;
  fullName: string;
  phone: string;
  email: string | null;
  employer: string | null;
  status: string;
  requestedLimitKobo: string; // serialized as a string — see apps/api/src/main.ts
  createdAt: string;
}

function formatNaira(kobo: string): string {
  return new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN" }).format(
    Number(kobo) / 100,
  );
}

// Placeholder for the real dashboard shell (§11.4) — role-scoped nav,
// command palette, saved views. This is the minimum that makes the product
// loop's step 5 real: an admin can see what applicants submitted (§2).
export default function DashboardOverview() {
  const router = useRouter();
  const [applications, setApplications] = useState<Application[] | null>(null);
  const [error, setError] = useState<string | null>(null);

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
  }, [router]);

  return (
    <main className="p-8">
      <h1 className="text-2xl font-bold text-text-dark">Applications</h1>
      <p className="mt-1 text-sm text-text-medium">
        Every submission from the public application form, newest first.
      </p>

      {error && <p className="mt-4 text-sm text-error">{error}</p>}

      {!error && applications === null && (
        <p className="mt-6 text-text-medium">Loading…</p>
      )}

      {applications?.length === 0 && (
        <p className="mt-6 text-text-medium">No applications submitted yet.</p>
      )}

      {applications && applications.length > 0 && (
        <div className="mt-6 overflow-x-auto rounded-lg border border-dark-border">
          <table className="w-full text-left text-sm">
            <thead className="bg-primary-surface text-text-dark">
              <tr>
                <th className="px-4 py-3">Reference</th>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Phone</th>
                <th className="px-4 py-3">Employer</th>
                <th className="px-4 py-3">Requested</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Submitted</th>
              </tr>
            </thead>
            <tbody>
              {applications.map((app) => (
                <tr key={app.id} className="border-t border-dark-border hover:bg-surface">
                  <td className="px-4 py-3">
                    <Link href={`/dashboard/applications/${app.id}`} className="font-medium text-primary">
                      {app.reference}
                    </Link>
                  </td>
                  <td className="px-4 py-3">{app.fullName}</td>
                  <td className="px-4 py-3">{app.phone}</td>
                  <td className="px-4 py-3">{app.employer ?? "—"}</td>
                  <td className="px-4 py-3">{formatNaira(app.requestedLimitKobo)}</td>
                  <td className="px-4 py-3 capitalize">{app.status.replace(/_/g, " ")}</td>
                  <td className="px-4 py-3">{new Date(app.createdAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
