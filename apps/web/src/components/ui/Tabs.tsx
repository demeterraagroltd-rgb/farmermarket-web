"use client";

import { useState } from "react";

interface TabsProps {
  tabs: Array<{ id: string; label: string }>;
  defaultTab?: string;
  children: (activeTab: string) => React.ReactNode;
}

// Plain, dependency-free tabs — a handful of underlined buttons swapping
// which child renders. The review workspace's evidence panel (§11.4) is
// the one place this is needed today; not worth a headless-UI dependency
// for that.
export function Tabs({ tabs, defaultTab, children }: TabsProps) {
  const [active, setActive] = useState(defaultTab ?? tabs[0]?.id);

  return (
    <div>
      <div className="flex gap-1 border-b border-dark-border/60 px-2">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActive(tab.id)}
            className={`-mb-px border-b-2 px-4 py-3 text-sm font-semibold transition-colors ${
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
