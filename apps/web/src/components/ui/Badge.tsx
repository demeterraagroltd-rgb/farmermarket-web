type Tone = "success" | "warning" | "error" | "info" | "neutral" | "gold";

const TONE_CLASSES: Record<Tone, string> = {
  success: "bg-success/10 text-success",
  warning: "bg-warning/10 text-warning",
  error: "bg-error/10 text-error",
  info: "bg-info/10 text-info",
  gold: "bg-gold/15 text-gold-dark",
  neutral: "bg-primary-surface text-text-medium",
};

// Semantic tone (good/warning/critical) is deliberately a separate palette
// from the brand accent (green/gold) — status should read at a glance
// without competing with the UI's own color language.
export function Badge({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${TONE_CLASSES[tone]}`}
    >
      {children}
    </span>
  );
}

const APPLICATION_STATUS_TONE: Record<string, Tone> = {
  draft: "neutral",
  submitted: "info",
  auto_checks: "info",
  info_required: "warning",
  credit_review: "info",
  escalated: "warning",
  approved: "success",
  auto_declined: "error",
  declined: "error",
  offer_issued: "success",
  offer_accepted: "success",
  offer_expired: "neutral",
  limit_active: "success",
  withdrawn: "neutral",
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <Badge tone={APPLICATION_STATUS_TONE[status] ?? "neutral"}>
      {status.replace(/_/g, " ")}
    </Badge>
  );
}
