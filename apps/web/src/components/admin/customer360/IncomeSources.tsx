"use client";

import { Badge } from "../../ui/Badge";
import { formatDate, formatNaira } from "../../../lib/format";
import type { IncomeSourcesView } from "../../../lib/customer360";
import { DataTable, Td } from "./parts";
import { useStoredData } from "./useStoredData";

// Who pays this customer, grouped from their stored credits. A pattern for a
// human to weigh — the grouping is by wording, so the original narrations are
// shown so it can be checked by eye.

const ordinal = (n: number) => {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
};

export function IncomeSources({ customerId }: { customerId: string }) {
  const { data, error } = useStoredData<IncomeSourcesView>(`/v1/admin/customers/${customerId}/income-sources?months=6`);

  if (error && !data) return <p className="text-sm text-error">{error}</p>;
  if (!data) return <p className="py-6 text-center text-sm text-text-muted">Grouping income sources…</p>;
  if (data.sources.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-text-muted">
        No credits stored in the last {data.months} months, so there are no income sources to show. Refresh the bank
        data if the account has recent activity.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <DataTable head={["Source", "Pattern", "Total", "Average", "Share", "Last paid"]}>
        {data.sources.map((s) => (
          <tr key={s.key}>
            <Td className="max-w-[300px]">
              <p className="truncate font-medium text-text-dark" title={s.label}>
                {s.label}
              </p>
              {s.samples.length > 1 && (
                <p className="truncate text-xs text-text-muted" title={s.samples.join("\n")}>
                  also: {s.samples.slice(1).join(" · ")}
                </p>
              )}
            </Td>
            <Td>
              <div className="flex flex-wrap gap-1.5">
                {s.likelySalary && <Badge tone="success">Likely salary</Badge>}
                {s.recurring ? (
                  <Badge tone="info">
                    {s.months} months{s.typicalDay ? ` · around the ${ordinal(s.typicalDay)}` : ""}
                  </Badge>
                ) : (
                  <Badge tone="neutral">{s.count === 1 ? "One-off" : `${s.count} payments`}</Badge>
                )}
              </div>
            </Td>
            <Td className="whitespace-nowrap tabular-nums text-text-dark">{formatNaira(s.totalKobo)}</Td>
            <Td className="whitespace-nowrap tabular-nums text-text-medium">{formatNaira(s.averageKobo)}</Td>
            <Td className="whitespace-nowrap tabular-nums text-text-medium">{Math.round(s.shareOfCredits * 100)}%</Td>
            <Td className="whitespace-nowrap text-text-muted">{formatDate(s.lastAt)}</Td>
          </tr>
        ))}
      </DataTable>
      <p className="text-xs text-text-muted">
        Last {data.months} months · {data.creditsAnalysed.toLocaleString()} credits · {formatNaira(data.totalCreditsKobo)} in
        total
        {data.otherKobo > 0 && ` (${formatNaira(data.otherKobo)} more from smaller sources)`}. Sources are grouped by the
        wording of the bank description, so treat the grouping as a guide, not a fact.
      </p>
    </div>
  );
}
