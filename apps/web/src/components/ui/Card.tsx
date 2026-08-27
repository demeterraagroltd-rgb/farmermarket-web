export function Card({
  children,
  className = "",
  style,
}: {
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <div
      className={`rounded-[var(--radius-lg)] border border-dark-border/60 bg-white shadow-[var(--shadow-card)] ${className}`}
      style={style}
    >
      {children}
    </div>
  );
}

export function PageHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-text-dark">{title}</h1>
        {description && <p className="mt-1 text-sm text-text-muted">{description}</p>}
      </div>
      {action}
    </div>
  );
}

export function EmptyState({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-[var(--radius-lg)] border border-dashed border-dark-border/60 py-16 text-center">
      <p className="text-sm text-text-muted">{label}</p>
    </div>
  );
}

// A small, honest label for sections built with representative numbers
// rather than a live query — reports, SLA/portfolio metrics, anything that
// needs a real data source (§12) that isn't wired up yet. The point isn't
// to hide that it's a mock, it's to show what the finished screen is meant
// to look like without a staff member mistaking sample numbers for real ones.
export function PreviewTag() {
  return (
    <span className="inline-flex items-center rounded-full border border-dashed border-gold/50 bg-gold/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-gold-dark">
      Preview data
    </span>
  );
}
