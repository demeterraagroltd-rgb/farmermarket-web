// Hand-rolled, same reasoning as icons.tsx: a couple of chart primitives
// don't justify a charting library dependency, and owning them outright
// keeps them themed to our tokens instead of a library's default look.

export function BarChart({
  data,
  color = "var(--color-primary)",
}: {
  data: Array<{ label: string; value: number }>;
  color?: string;
}) {
  const max = Math.max(...data.map((d) => d.value), 1);
  return (
    <div className="flex h-32 items-end gap-2.5">
      {data.map((d, i) => (
        <div key={i} className="flex flex-1 flex-col items-center gap-1.5">
          <div className="flex h-24 w-full items-end rounded-t-[6px] bg-surface">
            <div
              className="w-full rounded-t-[6px] transition-all"
              style={{ height: `${(d.value / max) * 100}%`, background: color }}
            />
          </div>
          <span className="text-[10px] font-medium text-text-muted">{d.label}</span>
        </div>
      ))}
    </div>
  );
}

// A ring gauge — stroke-dasharray on a circle rather than conic-gradient,
// so it stays crisp and themeable (conic-gradient can't take a CSS var
// hue easily across browsers the way an SVG stroke color can).
export function RingGauge({
  value,
  max = 100,
  size = 96,
  label,
  color = "var(--color-primary)",
}: {
  value: number;
  max?: number;
  size?: number;
  label?: string;
  color?: string;
}) {
  const stroke = 9;
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(1, value / max));
  const dash = circumference * pct;

  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--color-surface)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${dash} ${circumference}`}
        />
      </svg>
      <div className="absolute flex flex-col items-center">
        <span className="text-xl font-bold tabular-nums text-text-dark">{value}</span>
        {label && <span className="text-[10px] text-text-muted">{label}</span>}
      </div>
    </div>
  );
}
