import { Card } from "./Card";

// KPI tile — surface the summary before the detail table, per how a
// dashboard actually gets scanned rather than read top to bottom.
export function StatCard({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string | number;
  tone?: "default" | "warning" | "success";
}) {
  const valueColor =
    tone === "warning" ? "text-warning" : tone === "success" ? "text-success" : "text-text-dark";

  return (
    <Card className="px-5 py-4">
      <p className="text-xs font-semibold uppercase tracking-wider text-text-muted">{label}</p>
      <p className={`mt-1.5 text-2xl font-bold tabular-nums ${valueColor}`}>{value}</p>
    </Card>
  );
}
