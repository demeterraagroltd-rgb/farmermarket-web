"use client";

import { useCallback, useState } from "react";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { Input } from "../ui/Field";
import { accountFetch, readError } from "../../lib/customer";

// Mono Lookup BVN consent, applicant side (§9.1). Three legs because NIBSS
// makes the BVN holder approve the disclosure: type the BVN, pick where the
// code goes, enter the code. The session id stays on the API — the browser
// never sees or sends one.
//
// This is not the same shape as bank linking: there is no widget to hand off
// to, so the steps are ours to render.

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

interface OtpMethod {
  method: string;
  hint: string | null;
}

type Stage = "bvn" | "method" | "otp" | "done";

const VERDICT_COPY: Record<IdentityCheck["verdict"], string> = {
  match: "Your identity is confirmed.",
  partial: "Partly confirmed — a credit officer will take a look.",
  mismatch: "The details didn't match. A credit officer will be in touch.",
};

// NIBSS decides which contacts it will use — we can only order and label
// them. Email goes first: it works for everyone regardless of network, and
// until our own SMS provider is live it's the route we can best support.
const METHOD_ORDER = (m: string) =>
  m.includes("email") ? 0 : m === "alternate_phone" ? 2 : 1;

function methodLabel(m: OtpMethod): string {
  if (m.method.includes("email")) return m.hint ? `Email — ${m.hint}` : "Send to my email on file";
  if (m.method === "alternate_phone") return "Send to a phone number I choose";
  return m.hint ? `SMS — ${m.hint}` : "Send to my phone on file";
}

export function BvnVerifyCard({ onVerified }: { onVerified?: (c: IdentityCheck) => void }) {
  const [stage, setStage] = useState<Stage>("bvn");
  const [bvn, setBvn] = useState("");
  const [methods, setMethods] = useState<OtpMethod[]>([]);
  const [chosen, setChosen] = useState<string | null>(null);
  const [altPhone, setAltPhone] = useState("");
  const [altOpen, setAltOpen] = useState(false);
  const [otp, setOtp] = useState("");
  const [check, setCheck] = useState<IdentityCheck | null>(null);
  const [sandbox, setSandbox] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const post = useCallback(async (path: string, body: unknown) => {
    const res = await accountFetch(path, { method: "POST", body: JSON.stringify(body) });
    if (!res.ok) throw new Error(await readError(res));
    return res.json();
  }, []);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  const start = () =>
    run(async () => {
      const body = await post("/v1/kyc/bvn-lookup/start", { bvn: bvn.trim() });
      setMethods(
        [...((body.methods ?? []) as OtpMethod[])].sort(
          (a, b) => METHOD_ORDER(a.method) - METHOD_ORDER(b.method),
        ),
      );
      setSandbox(body.live === false);
      setStage("method");
    });

  const sendOtp = (method: string) =>
    run(async () => {
      const needsPhone = method === "alternate_phone";
      if (needsPhone && altPhone.trim().length < 7) {
        throw new Error("Enter the phone number the code should go to.");
      }
      await post("/v1/kyc/bvn-lookup/send-otp", {
        method,
        ...(needsPhone ? { phoneNumber: altPhone.trim() } : {}),
      });
      setChosen(method);
      setStage("otp");
    });

  const complete = () =>
    run(async () => {
      const body = await post("/v1/kyc/bvn-lookup/complete", { otp: otp.trim() });
      setCheck(body.check as IdentityCheck);
      setStage("done");
      onVerified?.(body.check as IdentityCheck);
    });

  if (stage === "done" && check) {
    const tone =
      check.verdict === "match"
        ? "text-primary"
        : check.verdict === "partial"
          ? "text-warning"
          : "text-error";
    return (
      <Card className="mt-6 p-5">
        <p className="text-sm font-medium text-text-dark">Identity verification</p>
        <p className={`mt-1 text-sm font-semibold ${tone}`}>{VERDICT_COPY[check.verdict]}</p>
        {check.recordName && (
          <p className="mt-1 text-xs text-text-muted">Checked against: {check.recordName}</p>
        )}
        {!check.live && (
          <p className="mt-2 text-xs text-warning">
            Sandbox result — no real BVN was checked.
          </p>
        )}
      </Card>
    );
  }

  return (
    <Card className="mt-6 p-5">
      <p className="text-sm font-medium text-text-dark">Verify your identity</p>
      <p className="mt-1 text-xs text-text-muted">
        We check your BVN against the national record. You&apos;ll approve it with a code sent to
        the phone number or email your bank has on file — we never see your banking password, and
        nothing can be moved from your account.
      </p>
      {sandbox && (
        <p className="mt-2 text-xs text-warning">
          Sandbox mode — this won&apos;t check a real BVN.
        </p>
      )}

      {stage === "bvn" && (
        <div className="mt-3 flex flex-col gap-3">
          <Input
            label="BVN"
            inputMode="numeric"
            maxLength={11}
            value={bvn}
            onChange={(e) => setBvn(e.target.value.replace(/\D/g, ""))}
          />
          <Button
            type="button"
            variant="secondary"
            disabled={busy || bvn.length !== 11}
            onClick={start}
          >
            {busy ? "Checking…" : "Continue"}
          </Button>
        </div>
      )}

      {stage === "method" && (
        <div className="mt-3 flex flex-col gap-3">
          <p className="text-xs text-text-medium">
            Where should we send your approval code? These are the contacts your bank has on file
            for this BVN.
          </p>
          {!methods.some((m) => m.method.includes("email")) && (
            <p className="text-xs text-text-muted">
              No email is on file for this BVN, so the code can only go by text message.
            </p>
          )}
          {methods.map((m) => (
            <div key={m.method} className="flex flex-col gap-2">
              {/* The number box only appears once they pick this option. */}
              {m.method === "alternate_phone" && altOpen && (
                <Input
                  label="Phone number"
                  inputMode="tel"
                  value={altPhone}
                  onChange={(e) => setAltPhone(e.target.value)}
                />
              )}
              <Button
                type="button"
                variant="secondary"
                disabled={busy}
                onClick={() =>
                  m.method === "alternate_phone" && !altOpen ? setAltOpen(true) : sendOtp(m.method)
                }
              >
                {m.method === "alternate_phone" && altOpen ? "Send code to this number" : methodLabel(m)}
              </Button>
            </div>
          ))}
        </div>
      )}

      {stage === "otp" && (
        <div className="mt-3 flex flex-col gap-3">
          <Input
            label="Approval code"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={8}
            value={otp}
            onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
          />
          <Button type="button" disabled={busy || otp.length < 4} onClick={complete}>
            {busy ? "Verifying…" : "Verify"}
          </Button>
          <button
            type="button"
            className="self-start text-xs text-text-muted underline"
            onClick={() => setStage("method")}
            disabled={busy}
          >
            Send the code somewhere else
          </button>
          {chosen === "alternate_phone" && (
            <p className="text-xs text-text-muted">Sent to {altPhone}.</p>
          )}
          {chosen?.includes("email") && (
            <p className="text-xs text-text-muted">
              Check the inbox of the email your bank has on file — and the spam folder.
            </p>
          )}
        </div>
      )}

      {error && <p className="mt-2 whitespace-pre-line text-xs text-error">{error}</p>}
    </Card>
  );
}
