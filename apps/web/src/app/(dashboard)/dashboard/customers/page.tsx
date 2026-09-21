"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { apiFetch, getToken, getRole } from "../../../../lib/auth";
import { formatNaira, formatDate } from "../../../../lib/format";
import {
  BANK_LABEL,
  BANK_TONE,
  EMPLOYMENT_LABEL,
  EMPLOYMENT_TONE,
  FRESHNESS_LABEL,
  FRESHNESS_TONE,
  KYC_LABEL,
  KYC_TONE,
  VERIFICATION_LABEL,
  VERIFICATION_TONE,
  initials,
  timeAgo,
  type CustomerListRow,
} from "../../../../lib/customer360";
import { PageHeader, Card, EmptyState } from "../../../../components/ui/Card";
import { Badge } from "../../../../components/ui/Badge";
import { Button } from "../../../../components/ui/Button";
import { ActionMenu, type MenuItem } from "../../../../components/ui/ActionMenu";
import { Input, Select, Textarea } from "../../../../components/ui/Field";
import { StatCard } from "../../../../components/ui/StatCard";

// The customer directory. Every row is a doorway to the Customer 360 page
// (dashboard/customers/[customerId]) — the name links there, and the ⋯ menu
// jumps straight to a tab. Delete is deliberately the *last* thing in the
// menu, not a button in the row: the primary interaction is looking at a
// customer, not removing one.
export default function CustomersPage() {
  const router = useRouter();
  const [customers, setCustomers] = useState<CustomerListRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [role, setRole] = useState<string | null>(null);

  // Suspend / activate / delete are super_admin/admin only on the API (§6.2);
  // hide those menu items for everyone else rather than let them 403.
  const canManage = role === "super_admin" || role === "admin";

  // Filters
  const [query, setQuery] = useState("");
  const [kyc, setKyc] = useState("all");
  const [bank, setBank] = useState("all");
  const [account, setAccount] = useState("all");

  // Confirm dialog (suspend | delete) plus in-flight / feedback state.
  const [dialog, setDialog] = useState<{ kind: "suspend" | "delete"; customer: CustomerListRow } | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function load() {
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
  }

  useEffect(() => {
    if (!getToken()) {
      router.push("/login");
      return;
    }
    setRole(getRole());
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stats = useMemo(() => {
    if (!customers) return null;
    return {
      total: customers.length,
      withLimit: customers.filter((c) => Number(c.creditLimitKobo ?? 0) > 0).length,
      bankConnected: customers.filter((c) => c.bankState === "connected").length,
      totalOutstandingKobo: customers.reduce((sum, c) => sum + Number(c.usedCreditKobo ?? 0), 0),
    };
  }, [customers]);

  const visible = useMemo(() => {
    if (!customers) return null;
    const q = query.trim().toLowerCase();
    return customers.filter((c) => {
      if (q && !`${c.fullName ?? ""} ${c.phone} ${c.email ?? ""}`.toLowerCase().includes(q)) return false;
      if (kyc !== "all" && (c.kycStatus ?? "unverified") !== kyc) return false;
      if (bank !== "all" && c.bankState !== bank) return false;
      if (account !== "all" && c.accountStatus !== account) return false;
      return true;
    });
  }, [customers, query, kyc, bank, account]);

  async function refreshBank(c: CustomerListRow) {
    setNotice(null);
    setError(null);
    try {
      const res = await apiFetch(`/v1/admin/customers/${c.id}/refresh-bank-data`, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.message ?? "Couldn't refresh bank data");
      setNotice(
        body.keptPreviousData
          ? `Mono returned nothing new for ${c.fullName ?? c.phone}, so the previous data was kept.`
          : `Bank data refreshed for ${c.fullName ?? c.phone}.`,
      );
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't refresh bank data");
    }
  }

  async function activate(c: CustomerListRow) {
    setNotice(null);
    setError(null);
    try {
      const res = await apiFetch(`/v1/admin/customers/${c.id}/reactivate`, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.message ?? "Failed to activate customer");
      setNotice(`${c.fullName ?? c.phone} is active again.`);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to activate customer");
    }
  }

  async function confirmDialog() {
    if (!dialog) return;
    const { kind, customer } = dialog;
    setBusy(true);
    setActionError(null);
    try {
      const res = await apiFetch(
        kind === "suspend" ? `/v1/admin/customers/${customer.id}/suspend` : `/v1/admin/customers/${customer.id}`,
        {
          method: kind === "suspend" ? "POST" : "DELETE",
          body: JSON.stringify(reason.trim() ? { reason: reason.trim() } : {}),
        },
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.message ?? `Failed to ${kind} customer`);
      const name = customer.fullName ?? customer.phone;
      setNotice(
        kind === "suspend"
          ? `${name} is suspended. They can no longer sign in — use Activate to restore access.`
          : body.outcome === "purged"
            ? `${name}'s record was permanently deleted — they had no orders or credit profile.`
            : `${name} has been deactivated. They can no longer sign in; you can activate them later.`,
      );
      setDialog(null);
      load();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : `Failed to ${kind} customer`);
    } finally {
      setBusy(false);
    }
  }

  function menuFor(c: CustomerListRow): MenuItem[] {
    const base = `/dashboard/customers/${c.id}`;
    const items: MenuItem[] = [
      { label: "View customer", href: base },
      { label: "Verify / refresh KYC", href: `/dashboard/kyc/${c.id}` },
      { label: "View financial profile", href: `${base}?tab=financial` },
      {
        label: "Refresh bank data",
        onSelect: () => refreshBank(c),
        disabled: c.bankState !== "connected",
        hint: c.bankState !== "connected" ? "No bank account linked" : undefined,
      },
      { label: "View orders", href: `${base}?tab=orders` },
      { label: "View repayments", href: `${base}?tab=repayments` },
      { label: "View credit applications", href: `${base}?tab=applications` },
    ];
    if (canManage) {
      items.push({ kind: "separator" });
      if (c.accountStatus === "suspended") {
        items.push({ label: "Activate account", onSelect: () => activate(c) });
      } else {
        items.push({
          label: "Suspend account",
          hint: "Blocks sign-in. Reversible.",
          onSelect: () => {
            setDialog({ kind: "suspend", customer: c });
            setReason("");
            setActionError(null);
          },
        });
        items.push({
          label: "Delete…",
          danger: true,
          hint: "Removes the record, or deactivates it if there's history.",
          onSelect: () => {
            setDialog({ kind: "delete", customer: c });
            setReason("");
            setActionError(null);
          },
        });
      }
    }
    return items;
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Customers"
        description="Everyone with an account. Open a customer for their full profile — identity, bank, income, orders and repayments."
      />

      {error && <p className="text-sm text-error">{error}</p>}
      {notice && (
        <p className="rounded-[var(--radius-sm)] bg-primary-surface px-4 py-2 text-sm text-primary-dark">{notice}</p>
      )}

      {stats && (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatCard label="Total customers" value={stats.total} />
          <StatCard label="With an active limit" value={stats.withLimit} tone="success" />
          <StatCard label="Bank connected" value={stats.bankConnected} />
          <StatCard label="Total outstanding" value={formatNaira(stats.totalOutstandingKobo)} />
        </div>
      )}

      {customers && customers.length > 0 && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Input
            label="Search"
            type="search"
            placeholder="Name, phone or email"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <Select label="KYC" value={kyc} onChange={(e) => setKyc(e.target.value)}>
            <option value="all">All</option>
            <option value="verified">Verified</option>
            <option value="submitted">In review</option>
            <option value="needs_more_info">Needs info</option>
            <option value="unverified">Not submitted</option>
          </Select>
          <Select label="Bank" value={bank} onChange={(e) => setBank(e.target.value)}>
            <option value="all">All</option>
            <option value="connected">Connected</option>
            <option value="requested">Requested</option>
            <option value="not_connected">Not connected</option>
          </Select>
          <Select label="Account" value={account} onChange={(e) => setAccount(e.target.value)}>
            <option value="all">All</option>
            <option value="active">Active</option>
            <option value="suspended">Suspended</option>
          </Select>
        </div>
      )}

      {customers?.length === 0 && <EmptyState label="No customers yet." />}
      {visible && customers && customers.length > 0 && visible.length === 0 && (
        <EmptyState label="No customers match those filters." />
      )}

      {visible && visible.length > 0 && (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[1100px] text-left text-sm">
            <thead>
              <tr className="border-b border-dark-border/60 text-xs font-semibold uppercase tracking-wide text-text-muted">
                <th className="px-4 py-3">Customer</th>
                <th className="px-4 py-3">Email</th>
                <th className="px-4 py-3">KYC</th>
                <th className="px-4 py-3">BVN</th>
                <th className="px-4 py-3">NIN</th>
                <th className="px-4 py-3">Bank</th>
                <th className="px-4 py-3">Employment</th>
                <th className="px-4 py-3">Registered</th>
                <th className="px-4 py-3">Last sync</th>
                <th className="px-4 py-3">Account</th>
                <th className="px-4 py-3 text-right">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {visible.map((c) => (
                <tr key={c.id} className="border-b border-dark-border/40 last:border-0 hover:bg-surface">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary-surface text-xs font-bold text-primary-dark">
                        {initials(c.fullName, c.phone)}
                      </div>
                      <div className="min-w-0">
                        <Link
                          href={`/dashboard/customers/${c.id}`}
                          className="block truncate font-semibold text-text-dark hover:text-primary hover:underline"
                        >
                          {c.fullName ?? "Unnamed customer"}
                        </Link>
                        <p className="truncate text-xs text-text-muted">{c.phone}</p>
                      </div>
                    </div>
                  </td>
                  <td className="max-w-[200px] truncate px-4 py-3 text-text-medium">{c.email ?? "—"}</td>
                  <td className="px-4 py-3">
                    <Badge tone={KYC_TONE[c.kycStatus ?? "unverified"]}>{KYC_LABEL[c.kycStatus ?? "unverified"]}</Badge>
                  </td>
                  <td className="px-4 py-3">
                    <Badge tone={VERIFICATION_TONE[c.bvnStatus]}>{VERIFICATION_LABEL[c.bvnStatus]}</Badge>
                  </td>
                  <td className="px-4 py-3">
                    <Badge tone={VERIFICATION_TONE[c.ninStatus]}>{VERIFICATION_LABEL[c.ninStatus]}</Badge>
                  </td>
                  <td className="px-4 py-3">
                    <Badge tone={BANK_TONE[c.bankState]}>{BANK_LABEL[c.bankState]}</Badge>
                  </td>
                  <td className="px-4 py-3">
                    <Badge tone={EMPLOYMENT_TONE[c.employmentState]}>{EMPLOYMENT_LABEL[c.employmentState]}</Badge>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-text-medium">{formatDate(c.createdAt)}</td>
                  <td className="whitespace-nowrap px-4 py-3">
                    {c.lastFinancialSyncAt ? (
                      <span className="flex items-center gap-2">
                        <span className="text-text-medium" title={new Date(c.lastFinancialSyncAt).toLocaleString()}>
                          {timeAgo(c.lastFinancialSyncAt)}
                        </span>
                        <Badge tone={FRESHNESS_TONE[c.freshness]}>{FRESHNESS_LABEL[c.freshness]}</Badge>
                      </span>
                    ) : (
                      <span className="text-text-muted">Never</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <Badge tone={c.accountStatus === "active" ? "success" : "error"}>
                      {c.accountStatus === "active" ? "Active" : "Suspended"}
                    </Badge>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <Link
                        href={`/dashboard/customers/${c.id}`}
                        className="rounded-[var(--radius-sm)] px-3 py-1.5 text-sm font-semibold text-primary hover:bg-primary-surface"
                      >
                        View
                      </Link>
                      <ActionMenu items={menuFor(c)} label={`Actions for ${c.fullName ?? c.phone}`} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {dialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <Card className="w-full max-w-md p-6">
            <h2 className="text-lg font-bold text-text-dark">
              {dialog.kind === "suspend" ? "Suspend" : "Delete"} {dialog.customer.fullName ?? dialog.customer.phone}?
            </h2>
            {dialog.kind === "suspend" ? (
              <p className="mt-2 text-sm text-text-muted">
                They&apos;ll be signed out and unable to sign in. Nothing is deleted — orders, repayments and KYC are
                kept, and <span className="font-semibold">Activate</span> restores access.
              </p>
            ) : (
              <p className="mt-2 text-sm text-text-muted">
                If this customer has never ordered and has no credit profile, their record is{" "}
                <span className="font-semibold text-error">deleted permanently</span>. Otherwise the account is{" "}
                <span className="font-semibold">deactivated</span> — order, ledger and KYC history are kept, they can
                no longer sign in, and you can activate them later.
              </p>
            )}
            <div className="mt-4">
              <Textarea
                label="Reason (optional)"
                rows={3}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Recorded on the audit log only."
              />
            </div>
            {actionError && <p className="mt-3 text-sm text-error">{actionError}</p>}
            <div className="mt-5 flex justify-end gap-3">
              <Button variant="ghost" onClick={() => setDialog(null)} disabled={busy}>
                Cancel
              </Button>
              <Button variant={dialog.kind === "delete" ? "danger" : "primary"} onClick={confirmDialog} disabled={busy}>
                {busy
                  ? dialog.kind === "suspend"
                    ? "Suspending…"
                    : "Removing…"
                  : dialog.kind === "suspend"
                    ? "Suspend customer"
                    : "Delete customer"}
              </Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
