"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { clearToken, getRole, getStaffEmail, type StaffRole } from "../../lib/auth";
import { CommandPalette } from "../../components/site/CommandPalette";
import {
  GridIcon,
  PeopleIcon,
  BoxIcon,
  BadgeCheckIcon,
  BankIcon,
  DocumentIcon,
  InboxIcon,
  LogOutIcon,
  MapPinIcon,
} from "../../components/ui/icons";

// Nav visibility mirrors each module's real @Roles() guard on the API —
// a sales account gets a 403 from /v1/admin/customers today, so it
// shouldn't see a "Customers" link that dead-ends. Overview is the one
// exception: every role lands somewhere, even if — for sales — that's a
// preview of a pipeline view that isn't built yet (§11.4).
//
// There is deliberately no "Applications" entry: that table hasn't been
// written to since registration moved onto applicant_profiles (see
// /dashboard root's redirect). Verification is the real, live decision
// queue — it reads applicant_profiles and is what actually gates checkout.
const NAV: Array<{ href: string; label: string; icon: typeof GridIcon; roles: StaffRole[] }> = [
  { href: "/dashboard/overview", label: "Overview", icon: GridIcon, roles: ["super_admin", "admin", "credit", "sales"] },
  { href: "/dashboard/customers", label: "Customers", icon: PeopleIcon, roles: ["super_admin", "admin", "credit"] },
  { href: "/dashboard/kyc", label: "Verification", icon: BadgeCheckIcon, roles: ["super_admin", "admin", "credit"] },
  { href: "/dashboard/bundles", label: "Bundles", icon: BoxIcon, roles: ["super_admin", "admin"] },
  { href: "/dashboard/inventory", label: "Inventory", icon: BoxIcon, roles: ["super_admin", "admin"] },
  { href: "/dashboard/purchasing", label: "Purchasing", icon: DocumentIcon, roles: ["super_admin", "admin"] },
  { href: "/dashboard/catalog", label: "Catalog", icon: BoxIcon, roles: ["super_admin", "admin"] },
  { href: "/dashboard/pickup-centers", label: "Pickup centres", icon: MapPinIcon, roles: ["super_admin", "admin"] },
  { href: "/dashboard/orders", label: "Orders", icon: DocumentIcon, roles: ["super_admin", "admin", "credit"] },
  { href: "/dashboard/repayments", label: "Repayments", icon: BankIcon, roles: ["super_admin", "admin", "credit"] },
  { href: "/dashboard/inbox", label: "Inbox", icon: InboxIcon, roles: ["super_admin", "admin"] },
  { href: "/dashboard/staff", label: "Staff", icon: BadgeCheckIcon, roles: ["super_admin"] },
];

const ROLE_LABEL: Record<StaffRole, string> = {
  super_admin: "Super admin",
  admin: "Admin",
  credit: "Credit",
  sales: "Sales",
};

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [role, setRole] = useState<StaffRole | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => { setRole(getRole()); setEmail(getStaffEmail()); }, []);
  useEffect(() => { setMenuOpen(false); }, [pathname]);
  const visibleNav = NAV.filter((item) => !role || item.roles.includes(role));
  const isLocalApi = process.env.NEXT_PUBLIC_API_URL?.includes("localhost") ?? false;
  function logout() { clearToken(); router.push("/login"); }
  return <div className="dashboard-theme min-h-screen">
    <CommandPalette nav={NAV} />
    {menuOpen && <button className="fixed inset-0 z-30 bg-black/35 lg:hidden" aria-label="Close navigation" onClick={() => setMenuOpen(false)} />}
    <aside className={`dashboard-sidebar fixed inset-y-0 left-0 z-40 flex w-[272px] flex-col px-4 py-7 transition-transform lg:translate-x-0 ${menuOpen ? "translate-x-0" : "-translate-x-full"}`}>
      <Link href="/dashboard/overview" className="mb-7 flex items-center gap-3 px-2">
        <Image src="/icon.png" alt="" width={38} height={38} className="rounded-xl" />
        <div><p className="text-xl font-bold tracking-tight text-white">Farmer<span className="text-[#59d87b]"> Market</span></p><p className="mt-1 text-[11px] text-emerald-100/70">Fresh food. Better tomorrow.</p></div>
      </Link>
      <button className="sidebar-search mb-6 flex items-center justify-between gap-2 rounded-xl px-3 py-3 text-xs" onClick={() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true, bubbles: true }))}>
        <span>⌕ &nbsp; Quick search…</span><kbd className="rounded bg-white/10 px-2 py-1 text-[10px]">Ctrl + K</kbd>
      </button>
      <nav aria-label="Dashboard navigation" className="space-y-1 overflow-y-auto">{visibleNav.map(({ href, label, icon: Icon }) => {
        const active = pathname === href || pathname?.startsWith(href + "/");
        return <Link key={href} href={href} aria-current={active ? "page" : undefined} className={`sidebar-link flex items-center gap-3 rounded-xl px-4 py-3 text-sm ${active ? "sidebar-link-active font-semibold" : "text-white/90"}`}><Icon className="h-6 w-6 shrink-0" />{label}</Link>;
      })}</nav>
      <div className="sidebar-message relative mt-auto overflow-hidden rounded-2xl border border-emerald-400/20 p-5"><span aria-hidden="true" className="text-3xl">❧</span><p className="mt-3 max-w-36 text-sm font-semibold leading-5 text-white">Good food builds stronger communities.</p></div>
      <button onClick={logout} className="mt-4 flex items-center gap-3 px-4 py-2 text-xs text-white/70 hover:text-white"><LogOutIcon className="h-4 w-4" />Log out</button>
    </aside>
    <div className="min-w-0 lg:pl-[272px]">
      <header className="dashboard-topbar flex h-[76px] items-center justify-between gap-4 px-5 sm:px-10">
        <button onClick={() => setMenuOpen(!menuOpen)} aria-expanded={menuOpen} aria-label="Toggle navigation" className="rounded-lg border border-slate-200 px-3 py-2 lg:hidden">☰</button>
        <span className="hidden text-xs text-slate-500 sm:block">Farmer Market Operations</span>
        <div className="ml-auto flex items-center gap-5">{role && ["admin", "super_admin"].includes(role) && <Link href="/dashboard/inbox" aria-label="Open inbox" className="rounded-full p-2 text-slate-700 hover:bg-emerald-50"><InboxIcon className="h-6 w-6" /></Link>}
          <div className="flex items-center gap-3"><div className="staff-avatar flex h-10 w-10 items-center justify-center rounded-full text-sm font-bold text-white">{(email ?? "A").slice(0,2).toUpperCase()}</div><div className="hidden sm:block"><p className="text-xs font-semibold text-slate-900">{email ?? "Staff account"}</p><p className="mt-1 text-xs text-slate-500">{role ? ROLE_LABEL[role] : "Staff"}</p></div></div>
        </div>
      </header>
      {isLocalApi && <div className="border-b border-emerald-100 bg-emerald-50/60 px-5 py-1 text-[10px] text-emerald-800 sm:px-10">Local preview · connected to the local API</div>}
      <main className="dashboard-content min-w-0 px-4 py-7 sm:px-8 xl:px-10">{children}</main>
    </div>
  </div>;
}
