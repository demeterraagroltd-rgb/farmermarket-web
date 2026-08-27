"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { clearToken } from "../../lib/auth";
import { InboxIcon, PeopleIcon, BoxIcon, BadgeCheckIcon, LogOutIcon } from "../../components/ui/icons";

const NAV = [
  { href: "/dashboard", label: "Applications", icon: InboxIcon },
  { href: "/dashboard/customers", label: "Customers", icon: PeopleIcon },
  { href: "/dashboard/catalog", label: "Catalog", icon: BoxIcon },
  { href: "/dashboard/staff", label: "Staff", icon: BadgeCheckIcon },
];

// Stand-in for the real dashboard shell (§11.4) — command palette,
// role-filtered nav, environment banner. This is a real sidebar with
// active-state highlighting, not a placeholder header bar.
export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();

  function handleLogout() {
    clearToken();
    router.push("/login");
  }

  return (
    <div className="flex min-h-screen bg-off-white">
      <aside className="flex w-60 shrink-0 flex-col border-r border-dark-border/60 bg-white px-4 py-6">
        <div className="flex items-center gap-2 px-2">
          <Image src="/icon.png" alt="" width={28} height={28} className="rounded-[var(--radius-sm)]" />
          <span className="font-bold text-text-dark">Farmer Market</span>
        </div>

        <nav className="mt-8 flex flex-col gap-1">
          {NAV.map(({ href, label, icon: Icon }) => {
            const active = pathname === href || (href !== "/dashboard" && pathname?.startsWith(href));
            return (
              <Link
                key={href}
                href={href}
                className={`flex items-center gap-3 rounded-[var(--radius-sm)] px-3 py-2 text-sm font-medium transition-colors ${
                  active
                    ? "bg-primary-surface text-primary-dark"
                    : "text-text-medium hover:bg-surface"
                }`}
              >
                <Icon className="h-5 w-5" />
                {label}
              </Link>
            );
          })}
        </nav>

        <button
          onClick={handleLogout}
          className="mt-auto flex items-center gap-3 rounded-[var(--radius-sm)] px-3 py-2 text-sm font-medium text-text-medium hover:bg-surface hover:text-error"
        >
          <LogOutIcon className="h-5 w-5" />
          Log out
        </button>
      </aside>

      <div className="flex-1 px-10 py-8">{children}</div>
    </div>
  );
}
