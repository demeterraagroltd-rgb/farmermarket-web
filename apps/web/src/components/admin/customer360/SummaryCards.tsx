"use client";

import { Card } from "../../ui/Card";
import { Badge } from "../../ui/Badge";
import { formatNaira } from "../../../lib/format";
import {
  BANK_LABEL,
  BANK_TONE,
  KYC_LABEL,
  KYC_TONE,
  timeAgo,
  type Customer360,
} from "../../../lib/customer360";
import { FreshnessBadge } from "./parts";

const REGULARITY_LABEL = { regular: "Regular", partial: "Partial", irregular: "Irregular" } as const;
const REGULARITY_TONE = { regular: "success", partial: "warning", irregular: "error" } as const;

function Tile({ label, children, sub }: { label: string; children: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <Card className="flex min-h-[92px] flex-col justify-between px-4 py-3.5">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">{label}</p>
      <div className="mt-2 text-xl font-bold tabular-nums text-text-dark">{children}</div>
      {sub && <p className="mt-1 text-xs text-text-muted">{sub}</p>}
    </Card>
  );
}

const NONE = <span className="text-base font-medium text-text-muted">—</span>;

// The top-level read: six facts an underwriter wants before any detail. Each
// one is a single stored value — nothing here triggers a Mono call — and the
// tabs below are where each of them is explained.
export function SummaryCards({ data }: { data: Customer360 }) {
  const s = data.summary;
  const bank = data.bank.accounts[0];
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
      <Tile label="KYC status">
        <Badge tone={KYC_TONE[s.kycStatus]}>{KYC_LABEL[s.kycStatus]}</Badge>
      </Tile>
      <Tile label="Bank status" sub={bank?.bankName ?? undefined}>
        <Badge tone={BANK_TONE[s.bankState]}>{BANK_LABEL[s.bankState]}</Badge>
      </Tile>
      <Tile label="Est. monthly income" sub={s.estimatedMonthlyIncomeKobo == null ? undefined : "From bank data"}>
        {s.estimatedMonthlyIncomeKobo == null ? NONE : formatNaira(s.estimatedMonthlyIncomeKobo)}
      </Tile>
      <Tile label="Income regularity">
        {s.incomeRegularity ? (
          <Badge tone={REGULARITY_TONE[s.incomeRegularity]}>{REGULARITY_LABEL[s.incomeRegularity]}</Badge>
        ) : (
          NONE
        )}
      </Tile>
      <Tile label="Bank balance" sub={s.bankBalanceKobo == null ? undefined : "At last sync"}>
        {s.bankBalanceKobo == null ? NONE : formatNaira(s.bankBalanceKobo)}
      </Tile>
      <Tile
        label="Last sync"
        sub={s.lastSyncAt ? <FreshnessBadge freshness={s.freshness} /> : undefined}
      >
        {s.lastSyncAt ? (
          <span className="text-base" title={new Date(s.lastSyncAt).toLocaleString()}>
            {timeAgo(s.lastSyncAt)}
          </span>
        ) : (
          NONE
        )}
      </Tile>
    </div>
  );
}
