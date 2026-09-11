"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, getRole, type StaffRole } from "../../lib/auth";

interface NavItem {
  href: string;
  label: string;
  roles: StaffRole[];
}

interface CustomerRow {
  id: string;
  fullName: string | null;
  phone: string;
  isVerified: boolean | null;
}

type Result =
  | { kind: "nav"; label: string; sublabel: string; href: string }
  | { kind: "customer"; label: string; sublabel: string; href: string };

// ⌘K / Ctrl-K palette for the dashboard: jump to a section, or find an
// applicant/customer by name or phone — takes you straight to their KYC
// review, the live decision page. The list is fetched once on first open
// and filtered client-side — no new endpoint.
export function CommandPalette({ nav }: { nav: NavItem[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const [customers, setCustomers] = useState<CustomerRow[] | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const role = typeof window !== "undefined" ? getRole() : null;
  const visibleNav = useMemo(
    () => nav.filter((n) => !role || n.roles.includes(role)),
    [nav, role],
  );

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      } else if (e.key === "Escape") {
        setOpen(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setCursor(0);
    setTimeout(() => inputRef.current?.focus(), 0);
    if (customers === null) {
      apiFetch("/v1/admin/customers")
        .then((r) => (r.ok ? r.json() : []))
        .then(setCustomers)
        .catch(() => setCustomers([]));
    }
  }, [open, customers]);

  const results = useMemo<Result[]>(() => {
    const q = query.trim().toLowerCase();
    const navHits: Result[] = visibleNav
      .filter((n) => !q || n.label.toLowerCase().includes(q))
      .map((n) => ({ kind: "nav", label: n.label, sublabel: "Section", href: n.href }));

    if (!q) return navHits;

    const custHits: Result[] = (customers ?? [])
      .filter((c) => c.fullName?.toLowerCase().includes(q) || c.phone?.includes(q))
      .slice(0, 8)
      .map((c) => ({
        kind: "customer",
        label: c.fullName || c.phone,
        sublabel: `${c.phone} · ${c.isVerified ? "verified" : "unverified"}`,
        href: `/dashboard/kyc/${c.id}`,
      }));

    return [...navHits, ...custHits];
  }, [query, visibleNav, customers]);

  const choose = useCallback(
    (r: Result | undefined) => {
      if (!r) return;
      setOpen(false);
      router.push(r.href);
    },
    [router],
  );

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/30 px-4 pt-[12vh]"
      onClick={() => setOpen(false)}
    >
      <div
        className="w-full max-w-lg overflow-hidden rounded-[var(--radius-lg)] border border-dark-border/60 bg-white shadow-[0_24px_60px_-12px_rgb(0_0_0_/_0.3)]"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setCursor(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setCursor((c) => Math.min(c + 1, results.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setCursor((c) => Math.max(c - 1, 0));
            } else if (e.key === "Enter") {
              e.preventDefault();
              choose(results[cursor]);
            }
          }}
          placeholder="Jump to a section, or find an applicant by name or phone…"
          className="w-full border-b border-dark-border/60 px-4 py-3.5 text-sm text-text-dark outline-none placeholder:text-text-muted"
        />
        <ul className="max-h-80 overflow-y-auto py-1">
          {results.length === 0 && (
            <li className="px-4 py-6 text-center text-sm text-text-muted">No matches.</li>
          )}
          {results.map((r, i) => (
            <li key={`${r.kind}-${r.href}`}>
              <button
                type="button"
                onMouseEnter={() => setCursor(i)}
                onClick={() => choose(r)}
                className={`flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left text-sm ${
                  i === cursor ? "bg-primary-surface" : ""
                }`}
              >
                <span className="font-medium text-text-dark">{r.label}</span>
                <span className="shrink-0 text-xs text-text-muted">{r.sublabel}</span>
              </button>
            </li>
          ))}
        </ul>
        <div className="border-t border-dark-border/60 px-4 py-2 text-[11px] text-text-muted">
          ↑↓ to move · ↵ to open · esc to close
        </div>
      </div>
    </div>
  );
}
