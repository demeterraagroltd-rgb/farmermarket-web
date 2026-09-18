"use client";

import { useState } from "react";
import { apiFetch } from "../../lib/auth";
import { formatDateTime } from "../../lib/format";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";

// Shared by the KYC detail page (dashboard/kyc/[userId]) and the Order
// Review workspace (dashboard/orders/[orderId]/review) — one read of the
// same Mono Lookup / Mono Connect data, one set of reviewer actions, so the
// two screens never drift into showing different things for the same
// applicant.

export const TONE: Record<string, "neutral" | "info" | "success" | "error" | "gold"> = {
  pending: "gold",
  accepted: "success",
  rejected: "error",
  submitted: "gold",
  needs_more_info: "error",
  verified: "success",
};

export function Field({ label, value }: { label: string; value: unknown }) {
  const v =
    value == null || value === ""
      ? "—"
      : typeof value === "object"
        ? JSON.stringify(value)
        : String(value);
  return (
    <div className="grid grid-cols-[130px_1fr] gap-2 py-1 text-sm">
      <span className="text-text-muted">{label}</span>
      <span className="font-medium text-text-dark">{v}</span>
    </div>
  );
}

export interface BankAnalysis {
  salaryDetected: boolean;
  estimatedMonthlyIncomeKobo: number | null;
  incomeConfidence: "high" | "medium" | "low" | null;
  salaryRegularity: "regular" | "partial" | "irregular" | null;
  employerNameMatch: boolean | null;
  monthsAnalysed: number;
  accountName: string | null;
  institution: string | null;
  balanceKobo: number | null;
  source: "income_api" | "statement" | "unavailable";
  pulledAt: string;
}

// The Mono bank-linking result (§9.1). Written by POST /v1/kyc/link-bank;
// null until the applicant links a salary account in the wizard.
export function BankAnalysisView({
  userId,
  analysis,
  linkedAt,
  requestedAt,
  onRequested,
}: {
  userId: string;
  analysis: unknown;
  linkedAt: string | null | undefined;
  requestedAt: string | null | undefined;
  onRequested: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!analysis || typeof analysis !== "object") {
    // Reviewer-initiated only — no "link your bank" prompt goes to an
    // applicant unless a credit officer actually asks for it here.
    async function request() {
      setBusy(true);
      setError(null);
      try {
        const res = await apiFetch(`/v1/admin/kyc/${userId}/request-bank-link`, { method: "PATCH" });
        if (!res.ok) throw new Error((await res.json()).message ?? "Failed");
        onRequested();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed");
      } finally {
        setBusy(false);
      }
    }

    return (
      <div className="py-1">
        <p className="mb-2 text-sm text-text-muted">
          {requestedAt
            ? `Requested ${formatDateTime(requestedAt)} — waiting on the applicant.`
            : "No account linked."}
        </p>
        <Button type="button" variant="secondary" disabled={busy} onClick={request}>
          {busy ? "Requesting…" : requestedAt ? "Resend request" : "Request bank verification"}
        </Button>
        {error && <p className="mt-1.5 text-xs text-error">{error}</p>}
      </div>
    );
  }
  const a = analysis as BankAnalysis;
  const naira = (kobo: number | null) =>
    kobo == null ? "—" : `₦${Math.round(kobo / 100).toLocaleString()}`;

  return (
    <div className="mt-1 rounded-[var(--radius-sm)] border border-dark-border/60 p-3 text-sm">
      <div className="mb-1.5 flex items-center gap-2">
        <Badge tone={a.salaryDetected ? "success" : "neutral"}>
          {a.salaryDetected ? "Salary detected" : "No clear salary"}
        </Badge>
        {a.employerNameMatch === true && <Badge tone="success">Employer matches</Badge>}
        {a.employerNameMatch === false && <Badge tone="error">Employer mismatch</Badge>}
      </div>
      <Field label="Est. monthly" value={naira(a.estimatedMonthlyIncomeKobo)} />
      <Field label="Regularity" value={a.salaryRegularity ?? "—"} />
      <Field label="Confidence" value={a.incomeConfidence ?? "—"} />
      <Field label="Bank" value={a.institution ?? "—"} />
      <Field label="Balance" value={naira(a.balanceKobo)} />
      <Field label="Months seen" value={a.monthsAnalysed || "—"} />
      <Field label="Source" value={a.source === "income_api" ? "Mono income" : a.source === "statement" ? "Statement" : "—"} />
      {linkedAt && <Field label="Linked" value={new Date(linkedAt).toLocaleDateString()} />}
    </div>
  );
}

// Mono Lookup's verdict (§9.1). Written either by the applicant's BVN consent
// flow (POST /v1/kyc/bvn-lookup/*) or by the NIN button here, which a reviewer
// can run unaided because the NIN is stored in plain text and NIN carries no
// consent leg. BVN can't work from this side: we hold only a hash of it.
export interface IdentityCheck {
  source: "bvn" | "nin";
  live: boolean;
  recordName: string | null;
  nameMatch: "exact" | "partial" | "mismatch";
  dateOfBirthMatch: boolean | null;
  genderMatch: boolean | null;
  phoneMatch: boolean | null;
  ninCorroborated: boolean | null;
  verdict: "match" | "partial" | "mismatch";
}

export function IdentityLookupView({
  userId,
  check,
  hasNin,
  bvnLast4,
  checkedAt,
  onChecked,
}: {
  userId: string;
  check: unknown;
  hasNin: boolean;
  /** Last 4 of the BVN on file — the full number is only ever stored hashed. */
  bvnLast4: string | null | undefined;
  checkedAt: string | null | undefined;
  onChecked: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function runNin() {
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch(`/v1/admin/kyc/${userId}/nin-lookup`, { method: "POST" });
      if (!res.ok) throw new Error((await res.json()).message ?? "Failed");
      onChecked();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  const c = check as IdentityCheck | null;
  const ninButton = (
    <Button type="button" variant="secondary" disabled={busy || !hasNin} onClick={runNin}>
      {busy ? "Checking…" : c ? "Re-check against NIN" : "Verify NIN"}
    </Button>
  );

  if (!c) {
    // Say what's on file and what's pending separately — "no BVN check" read
    // as "no BVN" to reviewers when one was provided but not yet verified.
    return (
      <div className="flex flex-col gap-1.5 py-1 text-sm">
        <p className="text-text-dark">
          <span className="text-text-muted">BVN: </span>
          {bvnLast4 ? (
            <>
              on file (•••• {bvnLast4}) — <span className="text-text-muted">not verified yet</span>
            </>
          ) : (
            <span className="text-text-muted">not provided</span>
          )}
        </p>
        {bvnLast4 && (
          // A reviewer can't run this one: we only hold a hash of the BVN,
          // and NIBSS needs the holder's own approval code.
          <p className="text-xs text-text-muted">
            The applicant verifies their BVN from their account page — it needs a code only they
            receive, so it can&apos;t be run from here.
          </p>
        )}
        <p className="mt-1 text-text-dark">
          <span className="text-text-muted">NIN: </span>
          {hasNin ? (
            <>
              on file — <span className="text-text-muted">not verified yet</span>
            </>
          ) : (
            <span className="text-text-muted">not provided</span>
          )}
        </p>
        {hasNin && <div className="mt-1">{ninButton}</div>}
        {error && <p className="mt-1.5 text-xs text-error">{error}</p>}
      </div>
    );
  }

  const yesNo = (v: boolean | null) => (v == null ? "—" : v ? "Matches" : "Mismatch");

  return (
    <div className="mt-1 rounded-[var(--radius-sm)] border border-dark-border/60 p-3 text-sm">
      <div className="mb-1.5 flex flex-wrap items-center gap-2">
        <Badge tone={c.verdict === "match" ? "success" : c.verdict === "partial" ? "warning" : "error"}>
          {c.verdict === "match" ? "Identity match" : c.verdict === "partial" ? "Partial match" : "Mismatch"}
        </Badge>
        <Badge tone="neutral">{c.source.toUpperCase()}</Badge>
        {/* A fake-client result must never read as an independent check. */}
        {!c.live && <Badge tone="warning">Sandbox — not verified</Badge>}
      </div>
      <Field label="Record name" value={c.recordName ?? "—"} />
      <Field label="Name" value={c.nameMatch} />
      <Field label="Date of birth" value={yesNo(c.dateOfBirthMatch)} />
      <Field label="Gender" value={yesNo(c.genderMatch)} />
      <Field label="Phone" value={yesNo(c.phoneMatch)} />
      <Field label="NIN corroborated" value={yesNo(c.ninCorroborated)} />
      {checkedAt && <Field label="Checked" value={formatDateTime(checkedAt)} />}
      <div className="mt-2">{ninButton}</div>
      {error && <p className="mt-1.5 text-xs text-error">{error}</p>}
    </div>
  );
}
