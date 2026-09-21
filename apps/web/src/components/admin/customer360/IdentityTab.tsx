"use client";

import { useState } from "react";
import Link from "next/link";
import { apiFetch } from "../../../lib/auth";
import { formatDate, formatDateTime } from "../../../lib/format";
import {
  KYC_LABEL,
  KYC_TONE,
  VERIFICATION_LABEL,
  VERIFICATION_TONE,
  type IdentityStatus,
} from "../../../lib/customer360";
import { Badge } from "../../ui/Badge";
import { Button } from "../../ui/Button";
import { DataTable, MatchBadge, Row, Section, Td, type TabProps } from "./parts";

const SOURCE_LABEL = { bvn: "BVN lookup", nin: "NIN lookup", mashup: "BVN + NIN (Mashup)" } as const;
const NAME_TONE = { exact: "success", partial: "warning", mismatch: "error" } as const;
const DOC_TONE: Record<string, "success" | "error" | "gold" | "neutral"> = {
  accepted: "success",
  rejected: "error",
  pending: "gold",
};

function CheckRow({ label, masked, s }: { label: string; masked?: string | null; s: IdentityStatus }) {
  return (
    <tr>
      <Td>
        <p className="font-semibold text-text-dark">{label}</p>
        {masked && <p className="font-mono text-xs text-text-muted">{masked}</p>}
      </Td>
      <Td>
        <div className="flex flex-col items-start gap-1">
          <Badge tone={VERIFICATION_TONE[s.state]}>{VERIFICATION_LABEL[s.state]}</Badge>
          {s.sandbox && <Badge tone="warning">Sandbox — not real</Badge>}
        </div>
      </Td>
      <Td className="whitespace-nowrap text-text-medium">{s.verifiedAt ? formatDate(s.verifiedAt) : "—"}</Td>
      <Td className="text-text-medium">{s.source ? SOURCE_LABEL[s.source] : "—"}</Td>
      <Td>{s.nameMatch ? <Badge tone={NAME_TONE[s.nameMatch]}>{s.nameMatch}</Badge> : <span className="text-text-muted">—</span>}</Td>
      <Td>{s.state === "not_provided" || s.state === "unverified" ? <span className="text-text-muted">—</span> : <MatchBadge value={s.dateOfBirthMatch} />}</Td>
      <Td>{s.state === "not_provided" || s.state === "unverified" ? <span className="text-text-muted">—</span> : <MatchBadge value={s.phoneMatch} />}</Td>
      <Td>{label === "BVN + NIN" && s.state !== "not_provided" && s.state !== "unverified" ? <MatchBadge value={s.ninCorroborated} /> : <span className="text-text-muted">—</span>}</Td>
    </tr>
  );
}

export function IdentityTab({ data, reload }: TabProps) {
  const { identity } = data;
  const [busy, setBusy] = useState<"nin" | "mashup" | null>(null);
  const [error, setError] = useState<string | null>(null);

  // The same endpoints the KYC review page's buttons call — one implementation
  // of the check, two places to trigger it. BVN alone can't be run from here:
  // it needs a code only the customer receives (they do it from /account).
  async function run(kind: "nin" | "mashup", path: string) {
    setBusy(kind);
    setError(null);
    try {
      const res = await apiFetch(`/v1/admin/kyc/${data.customer.id}/${path}`, { method: "POST" });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message ?? "The check failed");
      reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "The check failed");
    } finally {
      setBusy(null);
    }
  }

  const hasNin = identity.ninMasked !== null;
  const hasBvn = identity.bvnMasked !== null;
  const v = identity.verification;

  return (
    <div className="flex flex-col gap-4">
      <Section
        title="Identity checks"
        description="Each check compares what the customer declared with a government record. Full BVN and NIN are never shown."
        action={
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              onClick={() => run("mashup", "bvn-nin-lookup")}
              disabled={!!busy || !identity.bvnMashupAvailable || !hasNin}
              title={
                !hasNin
                  ? "No NIN on file"
                  : !identity.bvnMashupAvailable
                    ? "The BVN on file can't be recovered for this check — ask the customer to re-enter it"
                    : undefined
              }
            >
              {busy === "mashup" ? "Checking…" : "Verify BVN + NIN"}
            </Button>
            <Button variant="secondary" onClick={() => run("nin", "nin-lookup")} disabled={!!busy || !hasNin}>
              {busy === "nin" ? "Checking…" : "Verify NIN"}
            </Button>
          </div>
        }
      >
        {error && <p className="mb-3 text-sm text-error">{error}</p>}
        <DataTable head={["Identifier", "Status", "Verified", "Source", "Name", "Date of birth", "Phone", "NIN corroborated"]}>
          <CheckRow label="BVN" masked={identity.bvnMasked} s={identity.bvn} />
          <CheckRow label="NIN" masked={identity.ninMasked} s={identity.nin} />
          <CheckRow label="BVN + NIN" s={identity.mashup} />
        </DataTable>
        <p className="mt-3 text-xs text-text-muted">
          {hasBvn && identity.bvn.state === "unverified" && !identity.mashup.verifiedAt
            ? "The BVN check by code is done by the customer from their account page — it needs a code sent to them. "
            : ""}
          Only the most recent check is kept for now, so running one type can show the others as not checked.
        </p>
      </Section>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section
          title="KYC review"
          action={
            <Link href={`/dashboard/kyc/${data.customer.id}`} className="text-sm font-semibold text-primary hover:underline">
              Open review →
            </Link>
          }
        >
          {v ? (
            <>
              <Row label="Status" value={<Badge tone={KYC_TONE[v.status]}>{KYC_LABEL[v.status]}</Badge>} />
              <Row label="Submitted" value={v.submittedAt ? formatDateTime(v.submittedAt) : null} />
              <Row label="Verified" value={v.verifiedAt ? formatDateTime(v.verifiedAt) : null} />
              <Row label="Reviewer note" value={v.note} />
            </>
          ) : (
            <p className="text-sm text-text-muted">No KYC profile has been started.</p>
          )}
        </Section>

        <Section title="Documents" description="Uploaded by the customer; reviewed on the KYC page.">
          {identity.documents.length === 0 ? (
            <p className="text-sm text-text-muted">No documents uploaded.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {identity.documents.map((d) => (
                <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                  <span className="capitalize text-text-dark">{d.kind.replace(/_/g, " ")}</span>
                  <span className="flex items-center gap-2">
                    <Badge tone={DOC_TONE[d.status] ?? "neutral"}>{d.status}</Badge>
                    {d.url && (
                      <a href={d.url} target="_blank" rel="noopener noreferrer" className="text-xs font-semibold text-primary hover:underline">
                        View
                      </a>
                    )}
                  </span>
                  {d.rejectionReason && <span className="w-full text-xs text-error">{d.rejectionReason}</span>}
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>

      {identity.events.length > 0 && (
        <Section title="Verification history" description="Every change to this customer's KYC status.">
          <ol className="flex flex-col gap-3 border-l border-dark-border/60 pl-4">
            {identity.events.map((e) => (
              <li key={e.id} className="relative text-sm">
                <span className="absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full bg-primary" />
                <p className="text-text-dark">
                  {e.fromStatus ? `${e.fromStatus.replace(/_/g, " ")} → ` : ""}
                  <span className="font-semibold">{e.toStatus.replace(/_/g, " ")}</span>
                </p>
                {e.note && <p className="text-text-muted">{e.note}</p>}
                <p className="text-xs text-text-muted">{formatDateTime(e.createdAt)}</p>
              </li>
            ))}
          </ol>
        </Section>
      )}
    </div>
  );
}
