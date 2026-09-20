"use client";

import { useState } from "react";
import Link from "next/link";
import { SiteHeader } from "../../../components/site/SiteHeader";
import { Card } from "../../../components/ui/Card";
import { Button } from "../../../components/ui/Button";
import { Input } from "../../../components/ui/Field";
import { customerFetch, readError } from "../../../lib/customer";
import { PASSWORD_HELP, passwordProblem } from "../../../lib/password";

// Public password recovery: prove control of the phone with an SMS code, then
// choose a new password. This is also the only way an account created before
// passwords existed gets one, so it isn't an edge-case page — it's part of the
// credential model. Mirrors the Sign Up OTP legs exactly, with purpose "reset".
export default function ResetPasswordPage() {
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");

  const [verificationToken, setVerificationToken] = useState<string | null>(null);
  const [codeSent, setCodeSent] = useState(false);
  const [devCode, setDevCode] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  async function sendCode() {
    setError(null);
    setNotice(null);
    setLoading(true);
    try {
      const res = await customerFetch("/v1/auth/customer/otp/request", null, {
        method: "POST",
        body: JSON.stringify({ phone: phone.trim(), purpose: "reset" }),
      });
      if (!res.ok) throw new Error(await readError(res));
      const body = await res.json();
      setCodeSent(true);
      setDevCode(body.devCode ?? null);
      setNotice(
        body.sent
          ? "We've texted you a 6-digit code."
          : "We couldn't text a code right now — check back shortly or contact support.",
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't send a code.");
    } finally {
      setLoading(false);
    }
  }

  async function verifyCode() {
    setError(null);
    setLoading(true);
    try {
      const res = await customerFetch("/v1/auth/customer/otp/verify", null, {
        method: "POST",
        body: JSON.stringify({ phone: phone.trim(), code, purpose: "reset" }),
      });
      if (!res.ok) throw new Error(await readError(res));
      const body = await res.json();
      setVerificationToken(body.verificationToken);
    } catch (err) {
      setError(err instanceof Error ? err.message : "That code didn't work.");
    } finally {
      setLoading(false);
    }
  }

  async function submitNewPassword(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const problem = passwordProblem(password);
    if (problem) {
      setError(problem);
      return;
    }
    if (password !== confirm) {
      setError("The passwords don't match.");
      return;
    }
    setLoading(true);
    try {
      const res = await customerFetch("/v1/auth/customer/password/reset", null, {
        method: "POST",
        body: JSON.stringify({ phone: phone.trim(), phoneVerificationToken: verificationToken, password }),
      });
      if (!res.ok) throw new Error(await readError(res));
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't set the new password.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <SiteHeader />
      <main className="flex min-h-[calc(100vh-64px)] items-center justify-center bg-white px-6 py-16">
        <div className="w-full max-w-sm">
          <div className="mb-6 text-center">
            <h1 className="text-2xl font-bold tracking-tight text-text-dark">Reset your password</h1>
            <p className="mt-1.5 text-sm text-text-medium">
              We&apos;ll text a code to the phone number on your account, then you can choose a new
              password.
            </p>
          </div>

          {done ? (
            <Card className="p-6 text-center">
              <p className="text-sm font-semibold text-text-dark">Your password has been changed.</p>
              <p className="mt-1 text-sm text-text-medium">Sign in with it now.</p>
              <Link
                href="/account/login"
                className="mt-4 inline-flex items-center justify-center rounded-[var(--radius-sm)] bg-primary px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-primary-dark"
              >
                Go to sign in
              </Link>
            </Card>
          ) : (
            <Card className="p-6">
              <div className="flex flex-col gap-4">
                <Input
                  label="Phone number"
                  type="tel"
                  autoComplete="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  disabled={codeSent}
                  required
                />
                {!codeSent && (
                  <Button type="button" onClick={sendCode} disabled={loading || !phone.trim()}>
                    {loading ? "Sending…" : "Send me a code"}
                  </Button>
                )}

                {codeSent && !verificationToken && (
                  <>
                    <Input
                      label="6-digit code"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      maxLength={6}
                      value={code}
                      onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                      required
                    />
                    {devCode && (
                      <p className="text-xs text-text-muted">
                        SMS is in dry-run mode here — your code is {devCode}.
                      </p>
                    )}
                    <Button type="button" onClick={verifyCode} disabled={loading || code.length !== 6}>
                      {loading ? "Checking…" : "Verify code"}
                    </Button>
                  </>
                )}

                {verificationToken && (
                  <form onSubmit={submitNewPassword} className="flex flex-col gap-4">
                    <Input
                      label="New password"
                      type="password"
                      autoComplete="new-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                    />
                    <Input
                      label="Confirm new password"
                      type="password"
                      autoComplete="new-password"
                      value={confirm}
                      onChange={(e) => setConfirm(e.target.value)}
                      required
                    />
                    <p className="text-xs text-text-muted">{PASSWORD_HELP}</p>
                    <Button type="submit" disabled={loading}>
                      {loading ? "Saving…" : "Set new password"}
                    </Button>
                  </form>
                )}

                {notice && <p className="text-sm text-text-medium">{notice}</p>}
                {error && <p className="whitespace-pre-line text-sm text-error">{error}</p>}
              </div>
            </Card>
          )}

          <p className="mt-5 text-center text-sm text-text-muted">
            Remembered it?{" "}
            <Link href="/account/login" className="font-semibold text-primary hover:underline">
              Sign in
            </Link>
          </p>
        </div>
      </main>
    </>
  );
}
