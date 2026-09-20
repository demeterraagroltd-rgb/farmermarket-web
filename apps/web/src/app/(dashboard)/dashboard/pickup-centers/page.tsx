"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, getToken } from "../../../../lib/auth";
import { formatDate } from "../../../../lib/format";
import { PageHeader, Card, EmptyState } from "../../../../components/ui/Card";
import { Badge } from "../../../../components/ui/Badge";
import { Button } from "../../../../components/ui/Button";
import { Input } from "../../../../components/ui/Field";
import { PlusIcon } from "../../../../components/ui/icons";

interface PickupCenter {
  id: string;
  name: string;
  address: string;
  isActive: boolean;
  createdAt: string;
}

const EMPTY_FORM = { name: "", address: "" };

// Where buyers collect their orders — Farmer Market doesn't deliver to a
// street address, so this list is what the checkout dropdown offers. Same two
// roles that own the catalogue (§6.2).
export default function PickupCentersPage() {
  const router = useRouter();
  const [centers, setCenters] = useState<PickupCenter[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  function load() {
    apiFetch("/v1/admin/pickup-centers")
      .then(async (res) => {
        if (res.status === 401) {
          router.push("/login");
          return;
        }
        const body = await res.json();
        if (!res.ok) throw new Error(body.message ?? "Failed to load pickup centres");
        setCenters(body);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load pickup centres"));
  }

  useEffect(() => {
    if (!getToken()) {
      router.push("/login");
      return;
    }
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setFormError(null);
    try {
      const res = await apiFetch(
        editingId ? `/v1/admin/pickup-centers/${editingId}` : "/v1/admin/pickup-centers",
        { method: editingId ? "PATCH" : "POST", body: JSON.stringify(form) },
      );
      const body = await res.json();
      if (!res.ok) throw new Error(body.message ?? "Couldn't save that pickup centre");
      setForm(EMPTY_FORM);
      setEditingId(null);
      load();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Couldn't save that pickup centre");
    } finally {
      setSaving(false);
    }
  }

  async function patch(id: string, body: Record<string, unknown>) {
    setBusyId(id);
    setError(null);
    try {
      const res = await apiFetch(`/v1/admin/pickup-centers/${id}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.message ?? "Couldn't update that pickup centre");
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't update that pickup centre");
    } finally {
      setBusyId(null);
    }
  }

  async function remove(centre: PickupCenter) {
    if (!window.confirm(`Delete ${centre.name}? This can't be undone.`)) return;
    setBusyId(centre.id);
    setError(null);
    try {
      const res = await apiFetch(`/v1/admin/pickup-centers/${centre.id}`, { method: "DELETE" });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.message ?? "Couldn't delete that pickup centre");
      load();
    } catch (err) {
      // The common refusal: orders already point at it, so it can only be
      // deactivated — say that rather than leaving a mystery error.
      setError(err instanceof Error ? err.message : "Couldn't delete that pickup centre");
    } finally {
      setBusyId(null);
    }
  }

  function startEdit(centre: PickupCenter) {
    setEditingId(centre.id);
    setForm({ name: centre.name, address: centre.address });
    setFormError(null);
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <PageHeader
        title="Pickup centres"
        description="Where buyers collect their orders. Only active centres appear at checkout."
      />

      <Card className="p-5">
        <h2 className="text-sm font-semibold text-text-dark">
          {editingId ? "Edit pickup centre" : "Add a pickup centre"}
        </h2>
        <form onSubmit={handleSubmit} className="mt-4 grid gap-4">
          <Input
            label="Name"
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            placeholder="FCDA Secretariat"
            required
          />
          <Input
            label="Address"
            value={form.address}
            onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
            placeholder="Plot 1, Secretariat Road, Wuse, Abuja"
            required
          />
          {formError && <p className="whitespace-pre-line text-sm text-error">{formError}</p>}
          <div className="flex justify-end gap-2 border-t border-dark-border/60 pt-4">
            {editingId && (
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setEditingId(null);
                  setForm(EMPTY_FORM);
                  setFormError(null);
                }}
              >
                Cancel
              </Button>
            )}
            <Button type="submit" disabled={saving}>
              <PlusIcon className="h-4 w-4" />
              {saving ? "Saving…" : editingId ? "Save changes" : "Add pickup centre"}
            </Button>
          </div>
        </form>
      </Card>

      {error && <p className="whitespace-pre-line text-sm text-error">{error}</p>}

      {centers?.length === 0 && <EmptyState label="No pickup centres yet — add the first one above." />}

      {centers && centers.length > 0 && (
        <Card className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-dark-border/60 text-xs font-semibold uppercase tracking-wide text-text-muted">
                <th className="px-5 py-3">Centre</th>
                <th className="px-5 py-3">Status</th>
                <th className="px-5 py-3">Added</th>
                <th className="px-5 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {centers.map((c) => (
                <tr key={c.id} className="border-b border-dark-border/40 last:border-0 hover:bg-surface">
                  <td className="px-5 py-3">
                    <p className="font-medium text-text-dark">{c.name}</p>
                    <p className="text-xs text-text-muted">{c.address}</p>
                  </td>
                  <td className="px-5 py-3">
                    <Badge tone={c.isActive ? "success" : "neutral"}>
                      {c.isActive ? "Active" : "Inactive"}
                    </Badge>
                  </td>
                  <td className="px-5 py-3 text-text-medium">{formatDate(c.createdAt)}</td>
                  <td className="px-5 py-3">
                    <div className="flex justify-end gap-2">
                      <Button variant="ghost" onClick={() => startEdit(c)} disabled={busyId === c.id}>
                        Edit
                      </Button>
                      <Button
                        variant="ghost"
                        onClick={() => patch(c.id, { isActive: !c.isActive })}
                        disabled={busyId === c.id}
                      >
                        {c.isActive ? "Deactivate" : "Activate"}
                      </Button>
                      <Button variant="ghost" onClick={() => remove(c)} disabled={busyId === c.id}>
                        Delete
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
