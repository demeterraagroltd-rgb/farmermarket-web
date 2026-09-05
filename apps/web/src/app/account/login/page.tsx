"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { SiteHeader } from "../../../components/site/SiteHeader";
import { Card } from "../../../components/ui/Card";
import { Button } from "../../../components/ui/Button";
import { Input } from "../../../components/ui/Field";
import { customerFetch, readError, saveCustomerSession } from "../../../lib/customer";

// Customer sign-in — phone + the 6-digit login code chosen at /apply, against
// POST /v1/auth/customer/login. Deliberately the same endpoint and the same
// credential the Flutter app uses: an account created (or signed in) here is
// signed in on the phone too, and vice versa — there is one login, not two.
//
// Wrapped in Suspense because it reads `?next=` via useSearchParams (Next's
// app router requires that even for a fully client-rendered page like this
// one) — `next` is where the cart sends someone who tries to check out
// signed out, so signing in returns them to checkout instead of stranding
// them on /account.
export default function CustomerLoginPage() {
  return (
    <Suspense>
      <CustomerLoginForm />
    </Suspense>
  );
}

function CustomerLoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get("next");
  const destination = next && next.startsWith("/") ? next : "/account";

  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await customerFetch("/v1/auth/customer/login", null, {
        method: "POST",
        body: JSON.stringify({ phone: phone.trim(), code }),
      });
      if (!res.ok) throw new Error(await readError(res));
      const body = await res.json();
      saveCustomerSession({
        token: body.accessToken,
        userId: body.userId,
        fullName: body.fullName ?? "",
        phone: phone.trim(),
        verificationStatus: body.verificationStatus ?? "unverified",
        hasTxnPin: body.hasTxnPin === true,
      });
      router.push(destination);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign in failed.");
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
            <h1 className="text-2xl font-bold tracking-tight text-text-dark">Sign in</h1>
            <p className="mt-1.5 text-sm text-text-medium">
              Use the phone number and login code from your Farmer Market account — the same one
              that works in the app.
            </p>
          </div>
          <Card className="p-6">
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <Input
                label="Phone number"
                type="tel"
                autoComplete="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                required
              />
              <Input
                label="6-digit login code"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                required
              />
              {error && <p className="whitespace-pre-line text-sm text-error">{error}</p>}
              <Button type="submit" disabled={loading || code.length !== 6} className="mt-1 w-full">
                {loading ? "Signing in…" : "Sign in"}
              </Button>
            </form>
          </Card>
          <p className="mt-5 text-center text-sm text-text-muted">
            No account yet?{" "}
            <Link href="/apply" className="font-semibold text-primary hover:underline">
              Apply for a credit limit
            </Link>
          </p>
        </div>
      </main>
    </>
  );
}
