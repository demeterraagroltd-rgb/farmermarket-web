// Shapes and display helpers for the Customer list and Customer 360 pages.
// The types mirror what apps/api/src/modules/customers returns (dates arrive as
// ISO strings, kobo as numbers or — for bigint columns — strings), and the
// label/tone tables are the one place a status is given a colour, so the list,
// the summary cards and every tab say the same thing about the same state.

export type VerificationState = "not_provided" | "unverified" | "verified" | "partial" | "mismatch";
export type FreshnessState = "never" | "fresh" | "stale";
export type BankState = "connected" | "requested" | "not_connected";
export type EmploymentState = "complete" | "partial" | "not_provided";
export type AccountStatus = "active" | "suspended";
export type KycStatus = "unverified" | "submitted" | "needs_more_info" | "verified";

export interface Freshness {
  state: FreshnessState;
  ageSeconds: number | null;
  freshForHours: number;
}

export interface IdentityStatus {
  state: VerificationState;
  source: "bvn" | "nin" | "mashup" | null;
  verifiedAt: string | null;
  sandbox: boolean;
  nameMatch: "exact" | "partial" | "mismatch" | null;
  dateOfBirthMatch: boolean | null;
  phoneMatch: boolean | null;
  genderMatch: boolean | null;
  ninCorroborated: boolean | null;
}

// ── list ─────────────────────────────────────────────────────────────────

export interface CustomerListRow {
  id: string;
  phone: string;
  fullName: string | null;
  email: string | null;
  createdAt: string;
  deactivatedAt: string | null;
  deactivatedReason: string | null;
  accountStatus: AccountStatus;
  creditLimitKobo: string | null;
  usedCreditKobo: string | null;
  tier: string | null;
  isVerified: boolean | null;
  kycStatus: KycStatus | null;
  bvnStatus: VerificationState;
  ninStatus: VerificationState;
  bankState: BankState;
  employmentState: EmploymentState;
  lastFinancialSyncAt: string | null;
  freshness: FreshnessState;
}

// ── detail ───────────────────────────────────────────────────────────────

export interface BankAnalysis {
  pulledAt: string;
  accountName: string | null;
  institution: string | null;
  balanceKobo: number | null;
  monthsAnalysed: number;
  salaryDetected: boolean;
  estimatedMonthlyIncomeKobo: number | null;
  incomeConfidence: "high" | "medium" | "low" | null;
  salaryRegularity: "regular" | "partial" | "irregular" | null;
  employerNameMatch: boolean | null;
  source: "income_api" | "statement" | "unavailable";
}

export interface IncomeComparison {
  declaredKobo: number | null;
  estimatedKobo: number | null;
  differenceKobo: number | null;
  divergence: number | null;
  band: "matches" | "moderate" | "large" | "unknown";
}

export interface ScheduleRow {
  id: string;
  orderId: string;
  amount: number;
  amountPaid: number;
  amountDue: number;
  dueDate: string;
  isPaid: boolean;
  isOverdue: boolean;
  daysPastDue: number;
  bucket: string;
  installmentNumber: number;
  totalInstallments: number;
  bnplPlanName: string;
}

export interface OrderRow {
  id: string;
  status: string;
  items: Array<{ name: string; quantity: number; unitPrice: number; imageUrl: string }>;
  subtotal: number;
  total: number;
  pickupCenterName: string | null;
  pickupCenterAddress: string | null;
  pickupDate: string | null;
  deliveryAddress: string | null;
  placedAt: string;
  rejectionReason: string | null;
  planName: string | null;
  repaymentStatus: "none" | "current" | "overdue" | "paid_up";
  repaid: number;
  outstanding: number;
}

export interface Customer360 {
  customer: {
    id: string;
    fullName: string | null;
    phone: string;
    email: string | null;
    registeredAt: string;
    phoneVerifiedAt: string | null;
    lastUpdatedAt: string;
    accountStatus: AccountStatus;
    suspendedAt: string | null;
    suspendedReason: string | null;
  };
  summary: {
    kycStatus: KycStatus;
    bankState: BankState;
    estimatedMonthlyIncomeKobo: number | null;
    incomeRegularity: "regular" | "partial" | "irregular" | null;
    bankBalanceKobo: number | null;
    lastSyncAt: string | null;
    freshness: Freshness;
  };
  declared: {
    fullName: string | null;
    phone: string | null;
    email: string | null;
    dateOfBirth: string | null;
    gender: string | null;
    maritalStatus: string | null;
    dependantsCount: number | null;
    address: { street: string; city: string; state: string; lga: string } | null;
    state: string | null;
    lga: string | null;
    stateOfOrigin: string | null;
    lgaOfOrigin: string | null;
    nextOfKin: { name: string; relationship: string; phone: string } | null;
    employmentType: string | null;
    employer: string | null;
    jobTitle: string | null;
    declaredMonthlyIncomeKobo: number | null;
    salaryDay: number | null;
    yearsEmployed: string | null;
    requestedLimitKobo: number | null;
    employmentState: EmploymentState;
  } | null;
  identity: {
    bvnMasked: string | null;
    ninMasked: string | null;
    bvn: IdentityStatus;
    nin: IdentityStatus;
    mashup: IdentityStatus;
    latestCheck: unknown;
    bvnMashupAvailable: boolean;
    verification: {
      status: KycStatus;
      note: string | null;
      submittedAt: string | null;
      verifiedAt: string | null;
    } | null;
    documents: Array<{
      id: string;
      kind: string;
      status: string;
      rejectionReason: string | null;
      uploadedAt: string | null;
      url?: string;
    }>;
    events: Array<{ id: string; fromStatus: string | null; toStatus: string; note: string | null; createdAt: string }>;
  };
  bank: {
    state: BankState;
    requestedAt: string | null;
    accounts: Array<{
      monoAccountId: string;
      bankName: string | null;
      accountName: string | null;
      accountMasked: string | null;
      currency: string;
      balanceKobo: number | null;
      status: "connected" | "disconnected" | "reauth_required";
      linkedAt: string | null;
      lastSyncAt: string | null;
      freshness: Freshness;
    }>;
    /** Stored transaction history: how much, and over what range. */
    transactions: { count: number; earliest: string | null; latest: string | null };
    /** The last ten attempts to reach Mono, failures included. */
    syncHistory: Array<{
      id: string;
      trigger: "link" | "customer" | "admin" | "webhook" | "system";
      status: "success" | "partial" | "failed" | "skipped";
      startedAt: string;
      durationMs: number | null;
      transactionsFetched: number;
      transactionsInserted: number;
      error: string | null;
      triggeredBy: string | null;
    }>;
  };
  financial: {
    analysis: BankAnalysis | null;
    salaryDetected: boolean | null;
    income: IncomeComparison;
    employerMatch: boolean | null;
    regularity: "regular" | "partial" | "irregular" | null;
    confidence: "high" | "medium" | "low" | null;
    monthsAnalysed: number;
    source: "income_api" | "statement" | "unavailable" | null;
    retrievedAt: string | null;
    freshness: Freshness;
  };
  credit: {
    totalLimit: number;
    usedAmount: number;
    availableAmount: number;
    tier: string;
    score: number | null;
    isVerified: boolean;
  };
  repayments: {
    summary: {
      totalFinanced: number;
      totalRepaid: number;
      outstanding: number;
      overdueCount: number;
      nextPayment: { dueDate: string; amountDue: number } | null;
      collectionStatus: "none" | "current" | "overdue" | "paid_up";
    };
    schedules: ScheduleRow[];
    history: Array<{
      id: string;
      amount: number;
      paidAt: string;
      orderId: string;
      installmentNumber: number;
      totalInstallments: number;
    }>;
  };
  orders: OrderRow[];
  applications: Array<{
    id: string;
    reference: string;
    status: string;
    channel: string;
    requestedLimitKobo: number | null;
    submittedAt: string | null;
    createdAt: string;
    decision: {
      outcome: string;
      approvedLimitKobo: number | null;
      tier: string | null;
      reasonCodes: string[];
      notes: string | null;
      decidedAt: string;
      decidedBy: string | null;
    } | null;
  }>;
  audit: Array<{
    id: string;
    action: string;
    at: string;
    staff: { name: string; email: string } | null;
    metadata: Record<string, unknown> | null;
  }>;
}

// ── display ──────────────────────────────────────────────────────────────

export type Tone = "success" | "warning" | "error" | "info" | "neutral" | "gold";

export const VERIFICATION_LABEL: Record<VerificationState, string> = {
  verified: "Verified",
  partial: "Partial match",
  mismatch: "Mismatch",
  unverified: "Not checked",
  not_provided: "Not provided",
};
export const VERIFICATION_TONE: Record<VerificationState, Tone> = {
  verified: "success",
  partial: "warning",
  mismatch: "error",
  unverified: "neutral",
  not_provided: "neutral",
};

export const KYC_LABEL: Record<KycStatus, string> = {
  verified: "Verified",
  submitted: "In review",
  needs_more_info: "Needs info",
  unverified: "Not submitted",
};
export const KYC_TONE: Record<KycStatus, Tone> = {
  verified: "success",
  submitted: "gold",
  needs_more_info: "error",
  unverified: "neutral",
};

export const BANK_LABEL: Record<BankState, string> = {
  connected: "Connected",
  requested: "Requested",
  not_connected: "Not connected",
};
export const BANK_TONE: Record<BankState, Tone> = {
  connected: "success",
  requested: "gold",
  not_connected: "neutral",
};

export const EMPLOYMENT_LABEL: Record<EmploymentState, string> = {
  complete: "Complete",
  partial: "Incomplete",
  not_provided: "Not provided",
};
export const EMPLOYMENT_TONE: Record<EmploymentState, Tone> = {
  complete: "success",
  partial: "warning",
  not_provided: "neutral",
};

export const ACCOUNT_STATUS_LABEL = {
  connected: "Connected",
  disconnected: "Disconnected",
  reauth_required: "Needs re-sign-in",
} as const;
export const ACCOUNT_STATUS_TONE = {
  connected: "success",
  disconnected: "error",
  reauth_required: "warning",
} as const;

export const SYNC_STATUS_TONE = {
  success: "success",
  partial: "warning",
  failed: "error",
  skipped: "neutral",
} as const;
export const SYNC_TRIGGER_LABEL = {
  link: "Customer linked account",
  customer: "Customer",
  admin: "Staff refresh",
  webhook: "Mono notification",
  system: "Scheduled",
} as const;

export const FRESHNESS_LABEL: Record<FreshnessState, string> = {
  fresh: "Fresh",
  stale: "Stale",
  never: "No data",
};
export const FRESHNESS_TONE: Record<FreshnessState, Tone> = {
  fresh: "success",
  stale: "warning",
  never: "neutral",
};

export const COLLECTION_LABEL: Record<Customer360["repayments"]["summary"]["collectionStatus"], string> = {
  none: "No repayments",
  current: "Current",
  overdue: "Overdue",
  paid_up: "Paid up",
};
export const COLLECTION_TONE: Record<Customer360["repayments"]["summary"]["collectionStatus"], Tone> = {
  none: "neutral",
  current: "info",
  overdue: "error",
  paid_up: "success",
};

/** "2 hours ago" — coarse on purpose; the exact time is in the tooltip. */
export function timeAgo(iso: string | null | undefined, now: number = Date.now()): string {
  if (!iso) return "Never";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "Never";
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return "Just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hour${h === 1 ? "" : "s"} ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d} day${d === 1 ? "" : "s"} ago`;
  const mo = Math.round(d / 30);
  return `${mo} month${mo === 1 ? "" : "s"} ago`;
}

export function initials(name: string | null, phone: string): string {
  if (!name) return phone.slice(-2);
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}

export const TAB_IDS = [
  "overview",
  "personal",
  "identity",
  "bank",
  "financial",
  "transactions",
  "statements",
  "orders",
  "repayments",
  "applications",
  "activity",
] as const;
export type TabId = (typeof TAB_IDS)[number];

export function isTabId(v: string | null | undefined): v is TabId {
  return !!v && (TAB_IDS as readonly string[]).includes(v);
}

/** Audit `action` codes → the sentence an admin reads. Unknown codes fall back to the code. */
export const ACTION_LABEL: Record<string, string> = {
  "customer.viewed": "Viewed customer",
  "customer.profile_edited": "Edited customer profile",
  "customer.bank_data_refreshed": "Refreshed bank data",
  "customer.suspended": "Suspended account",
  "customer.deactivated": "Deactivated account",
  "customer.reactivated": "Reactivated account",
  "customer.purged": "Deleted customer",
  "kyc.view": "Viewed KYC file",
  "kyc.bank_link_requested": "Requested bank verification",
  "kyc.nin_lookup": "Verified NIN",
  "kyc.mashup_lookup": "Verified BVN + NIN",
  "customer.transaction_raw_viewed": "Viewed a transaction's raw Mono record",
  "customer.transactions_exported": "Exported bank transactions",
  "customer.mono_raw_viewed": "Viewed a raw Mono response",
};

// ── Stored bank data (Phase 4) ─────────────────────────────────────────────
// Mirrors apps/api/src/modules/customers/customer-financial.service.ts.

export interface FinancialAccount {
  id: string;
  label: string;
  institution: string | null;
  accountName: string | null;
  accountMasked: string | null;
  status: "active" | "disconnected" | "reauth_required";
}

export interface BankTransaction {
  id: string;
  bankAccountId: string;
  direction: "credit" | "debit";
  amountKobo: number;
  narration: string;
  occurredAt: string;
  balanceAfterKobo: number | null;
  /** Mono's own channel label — not our classification. */
  channel: string | null;
  /** Our analytical category; null until the analysis phase fills it. */
  category: string | null;
  retrievedAt: string;
}

export interface TransactionPage {
  items: BankTransaction[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  summary: { creditsKobo: number; debitsKobo: number; netKobo: number };
  coverage: { total: number; earliest: string | null; latest: string | null; dataAsOf: string | null };
  channels: string[];
  accounts: FinancialAccount[];
}

export interface TransactionDetail extends BankTransaction {
  externalId: string;
  firstSeenAt: string;
  /** Present only for roles allowed to see Mono's original record. */
  raw?: unknown;
}

export interface StatementPeriod {
  month: string;
  from: string;
  to: string;
  count: number;
  creditsKobo: number;
  debitsKobo: number;
  netKobo: number;
  openingKobo: number | null;
  closingKobo: number | null;
}

export interface StatementView {
  accounts: FinancialAccount[];
  accountId: string | null;
  periods: StatementPeriod[];
  totals: { count: number; creditsKobo: number; debitsKobo: number; netKobo: number } | null;
  range: { from: string; to: string } | null;
  dataAsOf: string | null;
}

export interface IncomeSource {
  key: string;
  label: string;
  count: number;
  months: number;
  totalKobo: number;
  averageKobo: number;
  lastAt: string;
  typicalDay: number | null;
  shareOfCredits: number;
  recurring: boolean;
  likelySalary: boolean;
  samples: string[];
}

export interface IncomeSourcesView {
  months: number;
  creditsAnalysed: number;
  sources: IncomeSource[];
  totalCreditsKobo: number;
  otherKobo: number;
  monthsCovered: number;
}

export interface RawResponseMeta {
  id: string;
  endpoint: string;
  retrievedAt: string;
  expiresAt: string;
  payloadBytes: number;
  syncLogId: string | null;
  bankAccountId: string | null;
  trigger: string | null;
}

export interface RawResponseList {
  storageEnabled: boolean;
  items: RawResponseMeta[];
}

export interface RawResponseView {
  id: string;
  endpoint: string;
  retrievedAt: string;
  expiresAt: string;
  payloadBytes: number;
  payload: unknown;
}

/** Roles that may see Mono's original records and export data. Mirrors the API. */
export const canSeeRawData = (role: string | null) => role === "super_admin" || role === "admin";

export const ENDPOINT_LABEL: Record<string, string> = {
  account_details: "Account details",
  transactions: "Transactions",
  income: "Income",
};
