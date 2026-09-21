"use client";

import { Card } from "../../ui/Card";
import { Badge } from "../../ui/Badge";
import {
  FRESHNESS_LABEL,
  FRESHNESS_TONE,
  timeAgo,
  type Customer360,
  type Freshness,
  type TabId,
} from "../../../lib/customer360";

/** What every tab needs from the page that hosts it. */
export interface TabProps {
  data: Customer360;
  /** Re-read the customer after an action changed something. */
  reload: () => void;
  /** Jump to another tab (also updates the URL). */
  goTab: (tab: TabId) => void;
  /** Staff role — used only to hide controls the API would 403 anyway. */
  role: string | null;
}

/** A titled card. Sections are the unit of progressive disclosure on the page. */
export function Section({
  title,
  description,
  action,
  children,
  className = "",
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Card className={`p-5 ${className}`}>
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-bold text-text-dark">{title}</h3>
          {description && <p className="mt-0.5 text-xs text-text-muted">{description}</p>}
        </div>
        {action}
      </div>
      {children}
    </Card>
  );
}

/**
 * Where a value came from. The whole point of the page is that "what the
 * customer said" and "what a record or the bank said" never look alike.
 */
export type Origin = "declared" | "verified" | "bank";
const ORIGIN: Record<Origin, { label: string; tone: "neutral" | "success" | "info" }> = {
  declared: { label: "Declared", tone: "neutral" },
  verified: { label: "Verified", tone: "success" },
  bank: { label: "From bank", tone: "info" },
};
export function OriginTag({ origin }: { origin: Origin }) {
  return <Badge tone={ORIGIN[origin].tone}>{ORIGIN[origin].label}</Badge>;
}

/** A label/value row. Empty values render as a muted dash, never as "null". */
export function Row({
  label,
  value,
  origin,
  mono,
}: {
  label: string;
  value: React.ReactNode;
  origin?: Origin;
  mono?: boolean;
}) {
  const empty = value === null || value === undefined || value === "";
  return (
    <div className="grid grid-cols-[150px_1fr] items-start gap-3 py-1.5 text-sm">
      <span className="text-text-muted">{label}</span>
      <span className={`flex flex-wrap items-center gap-2 font-medium text-text-dark ${mono ? "font-mono text-xs" : ""}`}>
        {empty ? <span className="font-normal text-text-muted">—</span> : value}
        {origin && !empty && <OriginTag origin={origin} />}
      </span>
    </div>
  );
}

/** Match / mismatch / couldn't-compare, as a badge. */
export function MatchBadge({ value }: { value: boolean | null }) {
  if (value === null) return <Badge tone="neutral">Not compared</Badge>;
  return value ? <Badge tone="success">Matches</Badge> : <Badge tone="error">Mismatch</Badge>;
}

export function FreshnessBadge({ freshness }: { freshness: Freshness }) {
  return <Badge tone={FRESHNESS_TONE[freshness.state]}>{FRESHNESS_LABEL[freshness.state]}</Badge>;
}

/** "Updated 2 hours ago" with the exact time on hover. */
export function Updated({ at, prefix = "Updated" }: { at: string | null | undefined; prefix?: string }) {
  if (!at) return <span className="text-text-muted">Never</span>;
  return (
    <span title={new Date(at).toLocaleString()}>
      {prefix} {timeAgo(at).toLowerCase()}
    </span>
  );
}

/** A small "not built yet" panel — honest about what a tab will hold and why it's empty. */
export function NotStoredYet({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-[var(--radius-lg)] border border-dashed border-dark-border/60 px-6 py-14 text-center">
      <p className="text-sm font-semibold text-text-dark">{title}</p>
      <p className="max-w-md text-sm text-text-muted">{children}</p>
    </div>
  );
}

/** A table shell with the page's header styling; the caller supplies <tr> rows. */
export function DataTable({ head, children }: { head: string[]; children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-dark-border/60 text-xs font-semibold uppercase tracking-wide text-text-muted">
            {head.map((h) => (
              <th key={h} className="whitespace-nowrap px-3 py-2">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}
export const Td = ({ children, className = "" }: { children?: React.ReactNode; className?: string }) => (
  <td className={`border-b border-dark-border/40 px-3 py-2.5 align-top ${className}`}>{children}</td>
);
