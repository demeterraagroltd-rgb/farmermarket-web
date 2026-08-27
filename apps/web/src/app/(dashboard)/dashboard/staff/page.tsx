"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, getToken } from "../../../../lib/auth";
import { formatDate } from "../../../../lib/format";
import { PageHeader, Card, EmptyState } from "../../../../components/ui/Card";
import { Badge } from "../../../../components/ui/Badge";
import { Button } from "../../../../components/ui/Button";
import { Input, Select } from "../../../../components/ui/Field";
import { PlusIcon } from "../../../../components/ui/icons";

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

const ROLE_TONE: Record<string, "gold" | "info" | "success" | "neutral"> = {
  super_admin: "gold",
  admin: "info",
  credit: "success",
  sales: "neutral",
};

const ROLE_LABEL: Record<string, string> = {
  super_admin: "Super admin",
  admin: "Admin",
  credit: "Credit",
  sales: "Sales",
};

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
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
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <PageHeader title="Staff" description="Accounts that can sign in to this dashboard." />

      {newCredentials && (
        <Card className="border-gold/40 bg-gold/5 p-5">
          <p className="text-sm font-semibold text-text-dark">
            Account created for {newCredentials.email} — save this now, it won&apos;t be shown again:
          </p>
          <p className="mt-2 font-mono text-sm text-text-dark">TOTP secret: {newCredentials.totpSecret}</p>
          <p className="mt-1 break-all font-mono text-xs text-text-muted">{newCredentials.otpauthUrl}</p>
        </Card>
      )}

      <Card className="p-5">
        <h2 className="text-sm font-semibold text-text-dark">Create a staff account</h2>
        <form onSubmit={handleCreate} className="mt-4 grid grid-cols-2 gap-4">
          <Input
            type="email"
            label="Email"
            value={form.email}
            onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
            required
          />
          <Input
            label="Full name"
            value={form.fullName}
            onChange={(e) => setForm((f) => ({ ...f, fullName: e.target.value }))}
            required
          />
          <Input
            type="password"
            label="Password (min 8 chars)"
            value={form.password}
            onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
            minLength={8}
            required
          />
          <Select
            label="Role"
            value={form.role}
            onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}
          >
            <option value="sales">Sales</option>
            <option value="credit">Credit</option>
            <option value="admin">Admin</option>
            <option value="super_admin">Super admin</option>
          </Select>
          {createError && <p className="col-span-2 text-sm text-error">{createError}</p>}
          <div className="col-span-2 flex justify-end border-t border-dark-border/60 pt-4">
            <Button type="submit" disabled={creating}>
              <PlusIcon className="h-4 w-4" />
              {creating ? "Creating…" : "Create staff account"}
            </Button>
          </div>
        </form>
      </Card>

      {error && <p className="text-sm text-error">{error}</p>}

      {staffList?.length === 0 && <EmptyState label="No staff accounts yet." />}

      {staffList && staffList.length > 0 && (
        <Card className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-dark-border/60 text-xs font-semibold uppercase tracking-wide text-text-muted">
                <th className="px-5 py-3">Staff</th>
                <th className="px-5 py-3">Role</th>
                <th className="px-5 py-3">Active</th>
                <th className="px-5 py-3">Created</th>
              </tr>
            </thead>
            <tbody>
              {staffList.map((s) => (
                <tr key={s.id} className="border-b border-dark-border/40 last:border-0 hover:bg-surface">
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-3">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary-surface text-xs font-bold text-primary-dark">
                        {initials(s.fullName)}
                      </div>
                      <div className="min-w-0">
                        <p className="truncate font-medium text-text-dark">{s.fullName}</p>
                        <p className="truncate text-xs text-text-muted">{s.email}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-5 py-3">
                    <Badge tone={ROLE_TONE[s.role] ?? "neutral"}>{ROLE_LABEL[s.role] ?? s.role}</Badge>
                  </td>
                  <td className="px-5 py-3">
                    <Badge tone={s.isActive ? "success" : "error"}>{s.isActive ? "Active" : "Inactive"}</Badge>
                  </td>
                  <td className="px-5 py-3 text-text-medium">{formatDate(s.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
