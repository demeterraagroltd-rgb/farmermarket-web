"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { clearToken, getRole, getStaffEmail, type StaffRole } from "../../lib/auth";
import { Badge } from "../../components/ui/Badge";
import {
  GridIcon,
  InboxIcon,
  PeopleIcon,
  BoxIcon,
  BadgeCheckIcon,
  BankIcon,
  DocumentIcon,
  LogOutIcon,
} from "../../components/ui/icons";

// Nav visibility mirrors each module's real @Roles() guard on the API —
// a sales account gets a 403 from /v1/admin/customers today, so it
// shouldn't see a "Customers" link that dead-ends. Overview is the one
// exception: every role lands somewhere, even if — for sales — that's a
// preview of a pipeline view that isn't built yet (§11.4).
const NAV: Array<{ href: string; label: string; icon: typeof GridIcon; roles: StaffRole[] }> = [
  { href: "/dashboard/overview", label: "Overview", icon: GridIcon, roles: ["super_admin", "admin", "credit", "sales"] },
  { href: "/dashboard", label: "Applications", icon: InboxIcon, roles: ["super_admin", "admin", "credit"] },
  { href: "/dashboard/customers", label: "Customers", icon: PeopleIcon, roles: ["super_admin", "admin", "credit"] },
  { href: "/dashboard/kyc", label: "Verification", icon: BadgeCheckIcon, roles: ["super_admin", "admin", "credit"] },
  { href: "/dashboard/catalog", label: "Catalog", icon: BoxIcon, roles: ["super_admin", "admin"] },
  { href: "/dashboard/orders", label: "Orders", icon: DocumentIcon, roles: ["super_admin", "admin", "credit"] },
  { href: "/dashboard/repayments", label: "Repayments", icon: BankIcon, roles: ["super_admin", "admin", "credit"] },
  { href: "/dashboard/staff", label: "Staff", icon: BadgeCheckIcon, roles: ["super_admin"] },
];

const ROLE_LABEL: Record<StaffRole, string> = {
  super_admin: "Super admin",
  admin: "Admin",
  credit: "Credit",
  sales: "Sales",
};

const ROLE_TONE: Record<StaffRole, "gold" | "info" | "success" | "neutral"> = {
  super_admin: "gold",
  admin: "info",
  credit: "success",
  sales: "neutral",
};

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [role, setRole] = useState<StaffRole | null>(null);
  const [email, setEmail] = useState<string | null>(null);

  // Read from localStorage only after mount — reading it during the first
  // render would disagree with the server-rendered markup (which has no
  // localStorage) and trip a hydration mismatch.
  useEffect(() => {
    setRole(getRole());
    setEmail(getStaffEmail());
  }, []);

  function handleLogout() {
    clearToken();
    router.push("/login");
  }

  const visibleNav = NAV.filter((item) => !role || item.roles.includes(role));
  const isLocalApi = process.env.NEXT_PUBLIC_API_URL?.includes("localhost") ?? false;

  return (
    <div className="flex min-h-screen bg-off-white">
      <aside className="flex w-64 shrink-0 flex-col border-r border-dark-border/60 bg-white px-4 py-6">
        <div className="flex items-center gap-2.5 px-2">
          <Image src="/icon.png" alt="" width={32} height={32} className="rounded-[var(--radius-sm)] shadow-[var(--shadow-card)]" />
          <div>
            <p className="text-sm font-bold leading-tight text-text-dark">Farmer Market</p>
            <p className="text-[11px] leading-tight text-text-muted">Operations</p>
          </div>
        </div>

        <nav className="mt-8 flex flex-col gap-1">
          {visibleNav.map(({ href, label, icon: Icon }) => {
            const active = pathname === href || (href !== "/dashboard" && href !== "/dashboard/overview" && pathname?.startsWith(href));
            return (
              <Link
                key={href}
                href={href}
                className={`flex items-center gap-3 rounded-[var(--radius-sm)] px-3 py-2 text-sm font-medium transition-colors ${
                  active
                    ? "bg-primary text-white shadow-[var(--shadow-card)]"
                    : "text-text-medium hover:bg-surface"
                }`}
              >
                <Icon className="h-5 w-5" />
                {label}
              </Link>
            );
          })}
        </nav>

        {/* A real gap in the product, shown honestly rather than hidden:
            sales has no dashboard section of its own yet (§11.4's "own
            pipeline and conversion" isn't built). Nav still lands them on
            Overview, which explains this rather than 403ing silently. */}
        {role === "sales" && (
          <p className="mt-4 rounded-[var(--radius-sm)] bg-surface px-3 py-2 text-xs text-text-muted">
            Applications, Customers and Catalog aren&apos;t open to Sales accounts yet.
          </p>
        )}

        <div className="mt-auto flex flex-col gap-3 border-t border-dark-border/60 pt-4">
          <div className="flex items-center gap-2.5 px-2">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary-surface text-xs font-bold text-primary-dark">
              {(email ?? "?")[0]?.toUpperCase()}
            </div>
            <div className="min-w-0">
              <p className="truncate text-xs font-semibold text-text-dark">{email ?? "—"}</p>
              {role && <Badge tone={ROLE_TONE[role]}>{ROLE_LABEL[role]}</Badge>}
            </div>
          </div>
          <button
            onClick={handleLogout}
            className="flex items-center gap-3 rounded-[var(--radius-sm)] px-3 py-2 text-sm font-medium text-text-medium hover:bg-surface hover:text-error"
          >
            <LogOutIcon className="h-5 w-5" />
            Log out
          </button>
        </div>
      </aside>

      <div className="flex flex-1 flex-col">
        {isLocalApi && (
          <div className="bg-warning/15 px-10 py-1.5 text-center text-xs font-semibold text-warning">
            Local development — talking to a local API
          </div>
        )}
        <div className="flex-1 px-10 py-8">{children}</div>
      </div>
    </div>
  );
}
