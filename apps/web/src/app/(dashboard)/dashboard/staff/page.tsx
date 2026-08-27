"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, getToken } from "../../../../lib/auth";

interface StaffMember {
  id: string;
  email: string;
  fullName: string;
  role: string;
  isActive: boolean;
  createdAt: string;
}

interface NewStaffCredentials {
  email: string;
  totpSecret: string;
  otpauthUrl: string;
}

// "Staff CRUD & role assignment" (§11.4) — super_admin only (§6.2). The
// created account's MFA secret is shown exactly once, here, right after
// creation — there's nowhere else to retrieve it afterward.
export default function StaffPage() {
  const router = useRouter();
  const [staffList, setStaffList] = useState<StaffMember[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newCredentials, setNewCredentials] = useState<NewStaffCredentials | null>(null);

  const [form, setForm] = useState({ email: "", password: "", fullName: "", role: "sales" });
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  function load() {
    apiFetch("/v1/admin/staff")
      .then(async (res) => {
        if (res.status === 401) {
          router.push("/login");
          return;
        }
        const body = await res.json();
        if (!res.ok) throw new Error(body.message ?? "Failed to load staff");
        setStaffList(body);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load staff"));
  }

  useEffect(() => {
    if (!getToken()) {
      router.push("/login");
      return;
    }
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    setCreateError(null);
    try {
      const res = await apiFetch("/v1/admin/staff", { method: "POST", body: JSON.stringify(form) });
      const body = await res.json();
      if (!res.ok) throw new Error(body.message ?? "Failed to create staff account");
      setNewCredentials({ email: body.email, totpSecret: body.totpSecret, otpauthUrl: body.otpauthUrl });
      setForm({ email: "", password: "", fullName: "", role: "sales" });
      load();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Failed to create staff account");
    } finally {
      setCreating(false);
    }
  }

  return (
    <main className="mx-auto max-w-3xl p-8">
      <h1 className="text-2xl font-bold text-text-dark">Staff</h1>

      {newCredentials && (
        <div className="mt-4 rounded-lg border border-gold bg-primary-surface p-4">
          <p className="font-semibold text-text-dark">
            Account created for {newCredentials.email} — save this now, it won't be shown again:
          </p>
          <p className="mt-2 font-mono text-sm text-text-dark">TOTP secret: {newCredentials.totpSecret}</p>
          <p className="mt-1 break-all font-mono text-xs text-text-medium">{newCredentials.otpauthUrl}</p>
        </div>
      )}

      <form onSubmit={handleCreate} className="mt-6 flex flex-wrap items-end gap-3 rounded-lg border border-dark-border p-4">
        <input
          type="email"
          placeholder="Email"
          value={form.email}
          onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
          className="rounded-md border border-dark-border px-3 py-2"
          required
        />
        <input
          placeholder="Full name"
          value={form.fullName}
          onChange={(e) => setForm((f) => ({ ...f, fullName: e.target.value }))}
          className="rounded-md border border-dark-border px-3 py-2"
          required
        />
        <input
          type="password"
          placeholder="Password (min 8 chars)"
          value={form.password}
          onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
          className="rounded-md border border-dark-border px-3 py-2"
          minLength={8}
          required
        />
        <select
          value={form.role}
          onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}
          className="rounded-md border border-dark-border px-3 py-2"
        >
          <option value="sales">sales</option>
          <option value="credit">credit</option>
          <option value="admin">admin</option>
          <option value="super_admin">super_admin</option>
        </select>
        <button
          type="submit"
          disabled={creating}
          className="rounded-md bg-primary px-4 py-2 font-semibold text-white disabled:opacity-50"
        >
          {creating ? "Creating…" : "Create staff account"}
        </button>
        {createError && <p className="w-full text-sm text-error">{createError}</p>}
      </form>

      {error && <p className="mt-4 text-sm text-error">{error}</p>}

      {staffList && (
        <div className="mt-6 overflow-x-auto rounded-lg border border-dark-border">
          <table className="w-full text-left text-sm">
            <thead className="bg-primary-surface text-text-dark">
              <tr>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Email</th>
                <th className="px-4 py-3">Role</th>
                <th className="px-4 py-3">Active</th>
                <th className="px-4 py-3">Created</th>
              </tr>
            </thead>
            <tbody>
              {staffList.map((s) => (
                <tr key={s.id} className="border-t border-dark-border">
                  <td className="px-4 py-3">{s.fullName}</td>
                  <td className="px-4 py-3">{s.email}</td>
                  <td className="px-4 py-3">{s.role}</td>
                  <td className="px-4 py-3">{s.isActive ? "Yes" : "No"}</td>
                  <td className="px-4 py-3">{new Date(s.createdAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
