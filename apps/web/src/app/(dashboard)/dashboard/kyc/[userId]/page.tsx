"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { apiFetch, getToken } from "../../../../../lib/auth";
import { formatDateTime } from "../../../../../lib/format";
import { PageHeader, Card } from "../../../../../components/ui/Card";
import { Badge } from "../../../../../components/ui/Badge";
import { Button } from "../../../../../components/ui/Button";
import { Textarea } from "../../../../../components/ui/Field";

interface Doc {
  id: string;
  kind: string;
  status: string;
  rejectionReason: string | null;
  mimeType?: string | null;
  url?: string;
  uploadedAt: string | null;
}
interface Detail {
  profile: Record<string, unknown> & {
    fullName: string;
    verificationStatus: string;
    verificationNote: string | null;
    bvnLast4: string | null;
  };
  documents: Doc[];
  events: Array<{ id: string; fromStatus: string | null; toStatus: string; note: string | null; createdAt: string }>;
}

const TONE: Record<string, "neutral" | "info" | "success" | "error" | "gold"> = {
  pending: "gold",
  accepted: "success",
  rejected: "error",
  submitted: "gold",
  needs_more_info: "error",
  verified: "success",
};

function Field({ label, value }: { label: string; value: unknown }) {
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

function Skeleton() {
  return (
    <div className="mx-auto flex max-w-6xl animate-pulse flex-col gap-6">
      <div className="h-8 w-48 rounded bg-dark-border/30" />
      <div className="grid gap-6 xl:grid-cols-[320px_1fr_340px]">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-64 rounded-[var(--radius-lg)] bg-dark-border/20" />
        ))}
      </div>
    </div>
  );
}

export default function KycDetailPage() {
  const router = useRouter();
  const { userId } = useParams<{ userId: string }>();
  const [data, setData] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  // Which document row has its inline reject box open, and the reason typed in it.
  const [rejectFor, setRejectFor] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");

  const load = useCallback(() => {
    apiFetch(`/v1/admin/kyc/${userId}`)
      .then(async (res) => {
        if (res.status === 401) return router.push("/login");
        const body = await res.json();
        if (!res.ok) throw new Error(body.message ?? `Failed to load (${res.status})`);
        setData(body);
        setError(null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"));
  }, [userId, router]);

  useEffect(() => {
    if (!getToken()) return void router.push("/login");
    load();
  }, [load, router]);

  async function acceptDoc(docId: string) {
    setBusy(true);
    try {
      const res = await apiFetch(`/v1/admin/kyc/${userId}/documents/${docId}`, {
        method: "PATCH",
        body: JSON.stringify({ status: "accepted" }),
      });
      if (!res.ok) throw new Error((await res.json()).message ?? "Failed");
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function confirmReject(docId: string) {
    if (!rejectReason.trim()) return;
    setBusy(true);
    try {
      const res = await apiFetch(`/v1/admin/kyc/${userId}/documents/${docId}`, {
        method: "PATCH",
        body: JSON.stringify({ status: "rejected", rejectionReason: rejectReason.trim() }),
      });
      if (!res.ok) throw new Error((await res.json()).message ?? "Failed");
      setRejectFor(null);
      setRejectReason("");
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function decide(decision: "verified" | "needs_more_info") {
    if (decision === "needs_more_info" && !note.trim()) {
      setError("Add a note telling the applicant what to fix.");
      return;
    }
    setBusy(true);
    try {
      const res = await apiFetch(`/v1/admin/kyc/${userId}/verification`, {
        method: "PATCH",
        body: JSON.stringify({ decision, note: note.trim() || undefined }),
      });
      if (!res.ok) throw new Error((await res.json()).message ?? "Failed");
      router.push("/dashboard/kyc");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
      setBusy(false);
    }
  }

  if (error && !data) return <p className="text-sm text-error">{error}</p>;
  if (!data) return <Skeleton />;

  const p = data.profile;
  const addr = (p.residentialAddress ?? {}) as Record<string, string>;
  const nok = (p.nextOfKin ?? {}) as Record<string, string>;

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <div className="flex flex-wrap items-center gap-3">
        <PageHeader title={p.fullName} description={String(p.phone ?? "")} />
        <Badge tone={TONE[p.verificationStatus] ?? "neutral"}>
          {p.verificationStatus.replace(/_/g, " ")}
        </Badge>
      </div>
      {error && <p className="text-sm text-error">{error}</p>}
      {p.verificationNote && (
        <p className="rounded-[var(--radius-sm)] bg-error/10 px-3 py-2 text-sm text-error">
          Last note to applicant: {p.verificationNote}
        </p>
      )}

      <div className="grid gap-6 xl:grid-cols-[320px_1fr_340px]">
        {/* Left — identity + history */}
        <div className="flex flex-col gap-6">
          <Card className="p-6">
            <h3 className="mb-2 text-sm font-bold text-text-dark">Personal</h3>
            <Field label="Date of birth" value={p.dateOfBirth} />
            <Field label="Gender" value={p.gender} />
            <Field label="Marital status" value={p.maritalStatus} />
            <Field label="BVN" value={p.bvnLast4 ? `•••• ${p.bvnLast4}` : "—"} />
            <Field label="NIN" value={p.nin} />
            <h3 className="mb-2 mt-4 text-sm font-bold text-text-dark">Address &amp; origin</h3>
            <Field
              label="Residence"
              value={[addr.street, addr.city, addr.lga, addr.state].filter(Boolean).join(", ")}
            />
            <Field label="State of origin" value={p.stateOfOrigin} />
            <Field label="LGA of origin" value={p.lgaOfOrigin} />
            <h3 className="mb-2 mt-4 text-sm font-bold text-text-dark">Employment</h3>
            <Field label="Type" value={p.employmentType} />
            <Field label="Employer" value={p.employer} />
            <Field label="Job title" value={p.jobTitle} />
            <Field label="Requested" value={p.requestedLimitNaira ? `₦${p.requestedLimitNaira}` : "—"} />
            <h3 className="mb-2 mt-4 text-sm font-bold text-text-dark">Next of kin</h3>
            <Field label="Name" value={nok.name} />
            <Field label="Relationship" value={nok.relationship} />
            <Field label="Phone" value={nok.phone} />
          </Card>

          {data.events.length > 0 && (
            <Card className="p-6">
              <h3 className="mb-3 text-sm font-bold text-text-dark">History</h3>
              <ul className="flex flex-col gap-2 text-xs text-text-muted">
                {data.events.map((e) => (
                  <li key={e.id}>
                    {formatDateTime(e.createdAt)} · {e.fromStatus ?? "—"} → {e.toStatus}
                    {e.note ? ` · "${e.note}"` : ""}
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>

        {/* Centre — documents */}
        <Card className="p-6">
          <h3 className="mb-3 text-sm font-bold text-text-dark">Documents</h3>
          {data.documents.length === 0 ? (
            <p className="text-sm text-text-muted">No documents uploaded.</p>
          ) : (
            <div className="flex flex-col gap-4">
              {data.documents.map((d) => {
                const isImage = (d.mimeType ?? "").startsWith("image/");
                return (
                  <div key={d.id} className="rounded-[var(--radius-sm)] border border-dark-border/60 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium capitalize text-text-dark">
                            {d.kind.replace(/_/g, " ")}
                          </span>
                          <Badge tone={TONE[d.status] ?? "neutral"}>{d.status}</Badge>
                        </div>
                        {d.rejectionReason && <p className="mt-0.5 text-xs text-error">{d.rejectionReason}</p>}
                      </div>
                      <div className="flex shrink-0 gap-2">
                        <Button variant="secondary" onClick={() => acceptDoc(d.id)} disabled={busy}>
                          Accept
                        </Button>
                        <Button
                          variant="danger"
                          onClick={() => {
                            setRejectFor(rejectFor === d.id ? null : d.id);
                            setRejectReason("");
                          }}
                          disabled={busy}
                        >
                          Reject
                        </Button>
                      </div>
                    </div>

                    {d.url &&
                      (isImage ? (
                        <a href={d.url} target="_blank" rel="noreferrer" className="mt-3 block">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={d.url}
                            alt={d.kind}
                            className="max-h-64 w-full rounded-[var(--radius-sm)] border border-dark-border/60 object-contain"
                          />
                        </a>
                      ) : (
                        <a
                          href={d.url}
                          target="_blank"
                          rel="noreferrer"
                          className="mt-2 inline-block text-xs font-semibold text-primary hover:underline"
                        >
                          Open document
                        </a>
                      ))}

                    {rejectFor === d.id && (
                      <div className="mt-3 rounded-[var(--radius-sm)] bg-error/5 p-3">
                        <Textarea
                          label="Why is this document rejected?"
                          rows={2}
                          value={rejectReason}
                          onChange={(e) => setRejectReason(e.target.value)}
                        />
                        <div className="mt-2 flex gap-2">
                          <Button
                            variant="danger"
                            onClick={() => confirmReject(d.id)}
                            disabled={busy || !rejectReason.trim()}
                          >
                            Confirm rejection
                          </Button>
                          <Button variant="ghost" onClick={() => setRejectFor(null)} disabled={busy}>
                            Cancel
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        {/* Right — sticky decision */}
        <div className="xl:sticky xl:top-6 xl:self-start">
          <Card className="p-6">
            <h3 className="mb-3 text-sm font-bold text-text-dark">Decision</h3>
            <Textarea
              label="Note to applicant"
              rows={4}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Required when sending back for corrections"
            />
            <div className="mt-3 flex flex-col gap-2">
              <Button onClick={() => decide("verified")} disabled={busy}>
                Verify
              </Button>
              <Button
                variant="secondary"
                onClick={() => decide("needs_more_info")}
                disabled={busy || !note.trim()}
              >
                Send back for corrections
              </Button>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
