import type { IdentityCheck } from "../kyc/identity-match";

// Pure derivations behind the Customer 360 page — no I/O, so every rule the
// admin screen states ("BVN verified", "data is stale", "income differs from
// declared") is a tested function rather than logic buried in a controller or
// re-invented in the browser.

// ── Masking ────────────────────────────────────────────────────────────────

/** "12345678901" → "•••••••8901". Nothing shorter than `keep` is ever shown. */
export function maskTail(value: string | null | undefined, keep = 4): string | null {
  if (!value) return null;
  const v = String(value);
  if (v.length <= keep) return "•".repeat(v.length);
  return "•".repeat(v.length - keep) + v.slice(-keep);
}

// ── Identity verification status ───────────────────────────────────────────

export type VerificationState =
  | "not_provided" // the customer never gave this identifier
  | "unverified" // on file, never checked against a government record
  | "verified" // checked, and it agreed with what they declared
  | "partial" // checked, agreed in part — a reviewer should look
  | "mismatch"; // checked, and it disagreed

export interface IdentityStatus {
  state: VerificationState;
  /** The source that produced the latest result, when there is one. */
  source: IdentityCheck["source"] | null;
  verifiedAt: string | null;
  /** True when a fake client produced it: shown, but never counted as verified. */
  sandbox: boolean;
  nameMatch: IdentityCheck["nameMatch"] | null;
  dateOfBirthMatch: boolean | null;
  phoneMatch: boolean | null;
  genderMatch: boolean | null;
  ninCorroborated: boolean | null;
}

const EMPTY_RESULT = {
  source: null,
  verifiedAt: null,
  sandbox: false,
  nameMatch: null,
  dateOfBirthMatch: null,
  phoneMatch: null,
  genderMatch: null,
  ninCorroborated: null,
} as const;

function fromCheck(check: IdentityCheck): IdentityStatus {
  // A sandbox result is real data about the *fake* — it must never read as
  // "verified" to a credit officer, whatever verdict it happens to carry.
  const state: VerificationState = !check.live
    ? "unverified"
    : check.verdict === "match"
      ? "verified"
      : check.verdict === "partial"
        ? "partial"
        : "mismatch";
  return {
    state,
    source: check.source,
    verifiedAt: check.checkedAt,
    sandbox: !check.live,
    nameMatch: check.nameMatch,
    dateOfBirthMatch: check.dateOfBirthMatch,
    phoneMatch: check.phoneMatch,
    genderMatch: check.genderMatch,
    ninCorroborated: check.ninCorroborated,
  };
}

/**
 * BVN, NIN and Mashup status, from the customer's identity checks.
 *
 * `history` is the latest check of each kind from identity_verifications, so
 * one check no longer erases another: a BVN check followed by a NIN check leaves
 * both on record. A BVN status is the more recent of the BVN and Mashup checks
 * (Mashup cross-checks the BVN too), and the same for NIN.
 *
 * `identityLookup` is the single latest check kept on the profile. It is read
 * only for a customer whose checks pre-date the history table, and then behaves
 * exactly as it always did — it can name only one kind.
 */
export function identityStatuses(input: {
  hasBvn: boolean;
  hasNin: boolean;
  history?: Partial<Record<IdentityCheck["source"], IdentityCheck>> | null;
  identityLookup?: IdentityCheck | null;
}): { bvn: IdentityStatus; nin: IdentityStatus; mashup: IdentityStatus } {
  const legacy = input.identityLookup ?? null;
  const byKind: Partial<Record<IdentityCheck["source"], IdentityCheck>> =
    input.history && Object.keys(input.history).length > 0
      ? input.history
      : legacy
        ? { [legacy.source]: legacy }
        : {};

  const latestOf = (kinds: IdentityCheck["source"][]): IdentityCheck | null => {
    let best: IdentityCheck | null = null;
    for (const k of kinds) {
      const c = byKind[k];
      if (c && (!best || Date.parse(c.checkedAt) > Date.parse(best.checkedAt))) best = c;
    }
    return best;
  };

  const build = (provided: boolean, matching: IdentityCheck | null): IdentityStatus => {
    if (matching) return fromCheck(matching);
    return { state: provided ? "unverified" : "not_provided", ...EMPTY_RESULT };
  };

  return {
    bvn: build(input.hasBvn, latestOf(["bvn", "mashup"])),
    nin: build(input.hasNin, latestOf(["nin", "mashup"])),
    mashup: build(input.hasBvn && input.hasNin, latestOf(["mashup"])),
  };
}

// ── Bank connection / employment ───────────────────────────────────────────

export type BankConnectionState = "connected" | "requested" | "not_connected";

export function bankConnectionState(p: {
  monoAccountId: string | null | undefined;
  bankLinkRequestedAt: Date | string | null | undefined;
}): BankConnectionState {
  if (p.monoAccountId) return "connected";
  return p.bankLinkRequestedAt ? "requested" : "not_connected";
}

export type EmploymentState = "complete" | "partial" | "not_provided";

/** The four employment facts underwriting needs (kyc.service REQUIRED_PROFILE_FIELDS). */
export function employmentState(p: {
  employmentType: string | null | undefined;
  employer: string | null | undefined;
  jobTitle: string | null | undefined;
  netMonthlySalaryKobo: unknown;
}): EmploymentState {
  const have = [p.employmentType, p.employer, p.jobTitle, p.netMonthlySalaryKobo].filter(
    (v) => v !== null && v !== undefined && v !== "",
  ).length;
  return have === 4 ? "complete" : have === 0 ? "not_provided" : "partial";
}

/** When financial data was last pulled from the bank: the analysis, else the link itself. */
export function lastFinancialSync(p: {
  bankAnalysis: { pulledAt?: string } | null | undefined;
  bankLinkedAt: Date | string | null | undefined;
}): string | null {
  const at = p.bankAnalysis?.pulledAt ?? p.bankLinkedAt ?? null;
  if (!at) return null;
  return at instanceof Date ? at.toISOString() : String(at);
}

// ── Freshness ──────────────────────────────────────────────────────────────

/** How long pulled bank data is trusted before the UI says it's stale. */
export const FINANCIAL_DATA_FRESH_HOURS = 24;

export type FreshnessState = "never" | "fresh" | "stale";

export interface Freshness {
  state: FreshnessState;
  /** Seconds since the data was retrieved; null when it never was. */
  ageSeconds: number | null;
  freshForHours: number;
}

export function freshnessOf(
  retrievedAt: Date | string | null | undefined,
  now: Date = new Date(),
  freshForHours: number = FINANCIAL_DATA_FRESH_HOURS,
): Freshness {
  if (!retrievedAt) return { state: "never", ageSeconds: null, freshForHours };
  const t = retrievedAt instanceof Date ? retrievedAt.getTime() : Date.parse(retrievedAt);
  if (!Number.isFinite(t)) return { state: "never", ageSeconds: null, freshForHours };
  const ageSeconds = Math.max(0, Math.round((now.getTime() - t) / 1000));
  return {
    state: ageSeconds <= freshForHours * 3600 ? "fresh" : "stale",
    ageSeconds,
    freshForHours,
  };
}

// ── Income: declared vs. what the bank shows ───────────────────────────────

export type IncomeBand = "matches" | "moderate" | "large" | "unknown";

export interface IncomeComparison {
  declaredKobo: number | null;
  estimatedKobo: number | null;
  /** estimated − declared. Positive: the bank shows more than they declared. */
  differenceKobo: number | null;
  /** |difference| / declared, as a fraction (0.12 = 12%). */
  divergence: number | null;
  band: IncomeBand;
}

// The same cut-offs the review workspace's "Decision signals" card uses, so
// the two screens never call the same customer "matching" and "differing".
const BAND_MATCHES_MAX = 0.15;
const BAND_MODERATE_MAX = 0.4;

export function compareIncome(declaredKobo: number | null, estimatedKobo: number | null): IncomeComparison {
  if (!declaredKobo || declaredKobo <= 0 || estimatedKobo == null) {
    return {
      declaredKobo: declaredKobo ?? null,
      estimatedKobo: estimatedKobo ?? null,
      differenceKobo: null,
      divergence: null,
      band: "unknown",
    };
  }
  const differenceKobo = estimatedKobo - declaredKobo;
  const divergence = Math.abs(differenceKobo) / declaredKobo;
  return {
    declaredKobo,
    estimatedKobo,
    differenceKobo,
    divergence,
    band: divergence <= BAND_MATCHES_MAX ? "matches" : divergence <= BAND_MODERATE_MAX ? "moderate" : "large",
  };
}

// ── Repayments ─────────────────────────────────────────────────────────────

export interface ScheduleLike {
  amount: number; // naira, as WalletService reports them
  amountPaid: number;
  dueDate: Date | string;
  isPaid: boolean;
  isOverdue: boolean;
}

export type CollectionStatus = "none" | "current" | "overdue" | "paid_up";

export interface RepaymentSummary {
  totalFinanced: number;
  totalRepaid: number;
  outstanding: number;
  overdueCount: number;
  nextPayment: { dueDate: string; amountDue: number } | null;
  collectionStatus: CollectionStatus;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function summariseRepayments(schedules: ScheduleLike[]): RepaymentSummary {
  if (schedules.length === 0) {
    return {
      totalFinanced: 0,
      totalRepaid: 0,
      outstanding: 0,
      overdueCount: 0,
      nextPayment: null,
      collectionStatus: "none",
    };
  }
  const totalFinanced = round2(schedules.reduce((s, r) => s + r.amount, 0));
  const totalRepaid = round2(schedules.reduce((s, r) => s + r.amountPaid, 0));
  const overdueCount = schedules.filter((r) => r.isOverdue).length;

  const upcoming = schedules
    .filter((r) => !r.isPaid)
    .map((r) => ({
      dueDate: r.dueDate instanceof Date ? r.dueDate.toISOString() : String(r.dueDate),
      amountDue: round2(r.amount - r.amountPaid),
    }))
    .sort((a, b) => Date.parse(a.dueDate) - Date.parse(b.dueDate));

  return {
    totalFinanced,
    totalRepaid,
    outstanding: round2(totalFinanced - totalRepaid),
    overdueCount,
    nextPayment: upcoming[0] ?? null,
    collectionStatus: overdueCount > 0 ? "overdue" : upcoming.length === 0 ? "paid_up" : "current",
  };
}
