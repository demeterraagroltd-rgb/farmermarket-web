"use client";

import { useState } from "react";

interface TabsProps {
  tabs: Array<{ id: string; label: string }>;
  defaultTab?: string;
  /** Controlled mode: the parent owns which tab is open (e.g. it lives in the URL). */
  activeTab?: string;
  onTabChange?: (id: string) => void;
  children: (activeTab: string) => React.ReactNode;
}

// Plain, dependency-free tabs — a handful of underlined buttons swapping
// which child renders. Uncontrolled by default (the review workspace's
// evidence panel); pass `activeTab` + `onTabChange` to control it, which the
// Customer 360 page does so "View Orders" from the customer list can open the
// page already on the right tab. The strip scrolls sideways rather than
// wrapping when there are more tabs than fit.
export function Tabs({ tabs, defaultTab, activeTab, onTabChange, children }: TabsProps) {
  const [inner, setInner] = useState(defaultTab ?? tabs[0]?.id);
  const controlled = activeTab !== undefined;
  const active = (controlled ? activeTab : inner) ?? tabs[0]?.id;

  return (
    <div>
      <div role="tablist" className="flex gap-1 overflow-x-auto border-b border-dark-border/60 px-2">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={active === tab.id}
            onClick={() => {
              if (!controlled) setInner(tab.id);
              onTabChange?.(tab.id);
            }}
            className={`-mb-px shrink-0 border-b-2 px-4 py-3 text-sm font-semibold transition-colors ${
              active === tab.id
                ? "border-primary text-primary"
                : "border-transparent text-text-muted hover:text-text-medium"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div className="p-5">{children(active)}</div>
    </div>
  );
}
