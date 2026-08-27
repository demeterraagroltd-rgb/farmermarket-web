"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { clearToken } from "../../lib/auth";

// Stand-in for the real dashboard shell (§11.4) — collapsible role-filtered
// rail, command palette, environment banner. This is just enough structure
// to move between the admin pages that exist today.
export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();

  function handleLogout() {
    clearToken();
    router.push("/login");
  }

  return (
    <div className="min-h-screen">
      <header className="flex items-center justify-between border-b border-dark-border px-8 py-4">
        <nav className="flex items-center gap-6">
          <span className="font-bold text-text-dark">Farmer Market</span>
          <Link href="/dashboard" className="text-sm text-text-medium hover:text-primary">
            Applications
          </Link>
          <Link href="/dashboard/staff" className="text-sm text-text-medium hover:text-primary">
            Staff
          </Link>
        </nav>
        <button onClick={handleLogout} className="text-sm text-text-medium hover:text-error">
          Log out
        </button>
      </header>
      {children}
    </div>
  );
}
