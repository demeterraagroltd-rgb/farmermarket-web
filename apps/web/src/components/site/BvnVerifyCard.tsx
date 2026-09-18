"use client";

import { useCallback, useEffect, useState } from "react";
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
//
// Two clocks run once a code has been requested, both driven by values the
// API returns (never guessed client-side, so they can't drift from what the
// server actually enforces — see kyc.service.ts sendBvnLookupOtp):
//   - the whole consent session, ~10 minutes, after which Mono discards it
//     and a fresh BVN submission is the only way forward;
//   - a 60-second resend cooldown, the same one the server enforces, so a
//     tap on "Resend" when it's disabled can't fire a real request anyway.

export interface IdentityCheck {
  source: "bvn" | "nin" | "mashup";
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

function mmss(totalSeconds: number): string {
  const s = Math.max(0, totalSeconds);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}

/** Pulls a wait time out of the server's 429 message as a fallback if the happy-path fields are ever missing. */
function parseWaitSeconds(message: string): number | null {
  const m = message.match(/wait (\d+)s/i);
  return m ? Number(m[1]) : null;
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

  // Wall-clock deadlines, not countdown values — a tab left in the
  // background still shows the right number when it comes back, instead of
  // one that only ticked while visible.
  const [sessionExpiresAt, setSessionExpiresAt] = useState<number | null>(null);
  const [resendAt, setResendAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (stage !== "method" && stage !== "otp") return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [stage]);

  const sessionSecondsLeft =
    sessionExpiresAt == null ? null : Math.max(0, Math.round((sessionExpiresAt - now) / 1000));
  const sessionExpired = sessionSecondsLeft === 0;
  const resendSecondsLeft = resendAt == null ? 0 : Math.max(0, Math.round((resendAt - now) / 1000));

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
      const message = e instanceof Error ? e.message : "Something went wrong. Please try again.";
      setError(message);
      // Belt and braces: the button is already disabled while resendSecondsLeft
      // > 0, but if the server's clock disagrees with ours, honour its wait
      // time rather than let a retry loop hammer it.
      const wait = parseWaitSeconds(message);
      if (wait != null) setResendAt(Date.now() + wait * 1000);
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
      setSessionExpiresAt(
        typeof body.expiresInSeconds === "number" ? Date.now() + body.expiresInSeconds * 1000 : null,
      );
      setResendAt(null);
      setStage("method");
    });

  const sendOtp = (method: string) =>
    run(async () => {
      const needsPhone = method === "alternate_phone";
      if (needsPhone && altPhone.trim().length < 7) {
        throw new Error("Enter the phone number the code should go to.");
      }
      const body = await post("/v1/kyc/bvn-lookup/send-otp", {
        method,
        ...(needsPhone ? { phoneNumber: altPhone.trim() } : {}),
      });
      setChosen(method);
      if (typeof body.expiresInSeconds === "number") {
        setSessionExpiresAt(Date.now() + body.expiresInSeconds * 1000);
      }
      setResendAt(
        typeof body.resendAvailableInSeconds === "number"
          ? Date.now() + body.resendAvailableInSeconds * 1000
          : Date.now() + 60_000,
      );
      setStage("otp");
    });

  const complete = () =>
    run(async () => {
      const body = await post("/v1/kyc/bvn-lookup/complete", { otp: otp.trim() });
      setCheck(body.check as IdentityCheck);
      setStage("done");
      onVerified?.(body.check as IdentityCheck);
    });

  // The session died server-side — nothing left on this bvn/session is
  // salvageable. Keep the BVN they already typed so restarting is one tap,
  // not eleven digits again.
  function restart() {
    setMethods([]);
    setChosen(null);
    setAltPhone("");
    setAltOpen(false);
    setOtp("");
    setSessionExpiresAt(null);
    setResendAt(null);
    setError(null);
    setStage("bvn");
  }

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

      {(stage === "method" || stage === "otp") && sessionSecondsLeft != null && (
        <p className={`mt-3 text-xs ${sessionExpired ? "font-medium text-error" : "text-text-muted"}`}>
          {sessionExpired
            ? "This verification session has expired."
            : `This session expires in ${mmss(sessionSecondsLeft)} — finish before then, or start again.`}
        </p>
      )}

      {stage === "method" && !sessionExpired && (
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

      {stage === "otp" && !sessionExpired && (
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
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <button
              type="button"
              className="text-xs text-text-muted underline disabled:cursor-not-allowed disabled:opacity-50"
              onClick={() => chosen && sendOtp(chosen)}
              disabled={busy || resendSecondsLeft > 0 || !chosen}
            >
              {resendSecondsLeft > 0 ? `Resend code (${resendSecondsLeft}s)` : "Resend code"}
            </button>
            <button
              type="button"
              className="text-xs text-text-muted underline"
              onClick={() => setStage("method")}
              disabled={busy}
            >
              Send it somewhere else
            </button>
          </div>
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

      {sessionExpired && (
        <div className="mt-3 flex flex-col gap-2">
          <p className="text-xs text-text-muted">
            Nothing was checked — start again with your BVN to get a fresh code.
          </p>
          <Button type="button" variant="secondary" onClick={restart}>
            Start again
          </Button>
        </div>
      )}

      {error && <p className="mt-2 whitespace-pre-line text-xs text-error">{error}</p>}
    </Card>
  );
}
