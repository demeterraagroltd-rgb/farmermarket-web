"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams, useParams } from "next/navigation";
import { apiFetch, getRole, getToken } from "../../../../../lib/auth";
import { isTabId, type Customer360, type TabId } from "../../../../../lib/customer360";
import { Card } from "../../../../../components/ui/Card";
import { Tabs } from "../../../../../components/ui/Tabs";
import { SummaryCards } from "../../../../../components/admin/customer360/SummaryCards";
import { OverviewTab } from "../../../../../components/admin/customer360/OverviewTab";
import { PersonalTab } from "../../../../../components/admin/customer360/PersonalTab";
import { IdentityTab } from "../../../../../components/admin/customer360/IdentityTab";
import { BankTab, FinancialTab } from "../../../../../components/admin/customer360/BankFinancialTabs";
import {
  ActivityTab,
  ApplicationsTab,
  OrdersTab,
  RepaymentsTab,
} from "../../../../../components/admin/customer360/CommerceTabs";
import { StatementsTab } from "../../../../../components/admin/customer360/StatementsTab";
import { TransactionsTab } from "../../../../../components/admin/customer360/TransactionsTab";
import { CustomerHeader } from "../../../../../components/admin/customer360/CustomerHeader";
import type { TabProps } from "../../../../../components/admin/customer360/parts";

function Skeleton() {
  return (
    <div className="flex animate-pulse flex-col gap-4">
      <div className="h-24 rounded-[var(--radius-lg)] bg-dark-border/20" />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="h-[92px] rounded-[var(--radius-lg)] bg-dark-border/20" />
        ))}
      </div>
      <div className="h-96 rounded-[var(--radius-lg)] bg-dark-border/20" />
    </div>
  );
}

function Customer360Page() {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const { customerId } = useParams<{ customerId: string }>();

  const [data, setData] = useState<Customer360 | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [role, setRole] = useState<string | null>(null);

  const tabParam = search.get("tab");
  const tab: TabId = isTabId(tabParam) ? tabParam : "overview";

  const goTab = useCallback(
    (t: TabId) => router.replace(`${pathname}?tab=${t}`, { scroll: false }),
    [router, pathname],
  );

  const load = useCallback(() => {
    apiFetch(`/v1/admin/customers/${customerId}`)
      .then(async (res) => {
        if (res.status === 401) return router.push("/login");
        const body = await res.json().catch(() => ({}));
        if (res.status === 403) throw new Error("Your role doesn't have access to customer profiles.");
        if (res.status === 404) throw new Error("This customer doesn't exist — they may have been deleted.");
        if (!res.ok) throw new Error(body.message ?? `Failed to load (${res.status})`);
        setData(body);
        setError(null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load customer"));
  }, [customerId, router]);

  useEffect(() => {
    if (!getToken()) return void router.push("/login");
    setRole(getRole());
    load();
  }, [load, router]);

  if (error && !data) {
    return (
      <div className="flex flex-col gap-3">
        <Link href="/dashboard/customers" className="text-sm font-semibold text-primary hover:underline">
          ← Customers
        </Link>
        <p className="text-sm text-error">{error}</p>
      </div>
    );
  }
  if (!data) return <Skeleton />;

  const props: TabProps = { data, reload: load, goTab, role };

  const tabs = [
    { id: "overview", label: "Overview" },
    { id: "personal", label: "Personal Info" },
    { id: "identity", label: "Identity Verification" },
    { id: "bank", label: "Bank Accounts" },
    { id: "financial", label: "Income & Analysis" },
    { id: "transactions", label: "Transactions" },
    { id: "statements", label: "Statements" },
    { id: "orders", label: `Orders${data.orders.length ? ` (${data.orders.length})` : ""}` },
    { id: "repayments", label: "Repayments" },
    { id: "applications", label: `Applications${data.applications.length ? ` (${data.applications.length})` : ""}` },
    { id: "activity", label: "Activity" },
  ];

  return (
    <div className="flex flex-col gap-4">
      <Link href="/dashboard/customers" className="w-fit text-sm font-semibold text-primary hover:underline">
        ← Customers
      </Link>
      {error && <p className="text-sm text-error">{error}</p>}

      <CustomerHeader data={data} reload={load} goTab={goTab} />
      <SummaryCards data={data} />

      <Card>
        <Tabs tabs={tabs} activeTab={tab} onTabChange={(id) => goTab(id as TabId)}>
          {(active) => {
            switch (active as TabId) {
              case "personal":
                return <PersonalTab {...props} />;
              case "identity":
                return <IdentityTab {...props} />;
              case "bank":
                return <BankTab {...props} />;
              case "financial":
                return <FinancialTab {...props} />;
              case "transactions":
                return <TransactionsTab {...props} />;
              case "statements":
                return <StatementsTab {...props} />;
              case "orders":
                return <OrdersTab {...props} />;
              case "repayments":
                return <RepaymentsTab {...props} />;
              case "applications":
                return <ApplicationsTab {...props} />;
              case "activity":
                return <ActivityTab {...props} />;
              default:
                return <OverviewTab {...props} />;
            }
          }}
        </Tabs>
      </Card>
    </div>
  );
}

// useSearchParams needs a Suspense boundary above it (Next bails out of static
// rendering otherwise); the skeleton doubles as the loading state.
export default function Page() {
  return (
    <Suspense fallback={<Skeleton />}>
      <Customer360Page />
    </Suspense>
  );
}
