"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "../ui/Button";
import { customerFetch, readError } from "../../lib/customer";

const PUBLIC_KEY = process.env.NEXT_PUBLIC_MONO_PUBLIC_KEY;

// The widget comes from Mono's npm package, bundled with the site, rather
// than the <script src="https://connect.withmono.com/connect.js"> the docs
// still show: that host stopped answering (connections time out), and a
// bank-linking step that dies on a third-party CDN is worse than one that
// ships with the page. The package mounts its iframe from connect.mono.co.
interface MonoConnectInstance {
  setup: () => void;
  open: () => void;
}
interface MonoConnectCtor {
  new (config: {
    key: string;
    scope: "auth";
    onSuccess: (payload: { code?: string }) => void;
    onClose?: () => void;
    onLoad?: () => void;
    // Required by Connect v2 — a name AND an email, or it won't open.
    data: { customer: { name: string; email: string } };
  }): MonoConnectInstance;
}

// Imported on demand: the package touches `window` at import time, which
// Next's server render doesn't have.
let ctorPromise: Promise<MonoConnectCtor> | null = null;
function loadConnect(): Promise<MonoConnectCtor> {
  ctorPromise ??= import("@mono.co/connect.js")
    .then((m) => (m.default ?? m) as unknown as MonoConnectCtor)
    .catch((e) => {
      ctorPromise = null; // allow a retry
      throw e;
    });
  return ctorPromise;
}

export interface BankAnalysis {
  salaryDetected: boolean;
  estimatedMonthlyIncomeKobo: number | null;
  salaryRegularity: "regular" | "partial" | "irregular" | null;
  employerNameMatch: boolean | null;
  institution: string | null;
  source: "income_api" | "statement" | "unavailable";
}

export function MonoConnectButton({
  token,
  customer,
  onLinked,
}: {
  token: string;
  customer?: { name?: string; email?: string };
  onLinked: (analysis: BankAnalysis) => void;
}) {
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const openedRef = useRef(false);

  useEffect(() => {
    if (!PUBLIC_KEY) return;
    loadConnect()
      .then(() => setReady(true))
      .catch(() => setError("Couldn't load the bank-linking widget. Refresh and try again."));
  }, []);

  const exchange = useCallback(
    async (code: string) => {
      setBusy(true);
      setError(null);
      try {
        const res = await customerFetch("/v1/kyc/link-bank", token, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code }),
        });
        if (!res.ok) throw new Error(await readError(res));
        const body = await res.json();
        onLinked(body.analysis as BankAnalysis);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn't link that account.");
      } finally {
        setBusy(false);
      }
    },
    [token, onLinked],
  );

  async function open() {
    if (!PUBLIC_KEY || openedRef.current) return;
    // Connect v2 refuses to open without both — say so here rather than let
    // the widget fail silently inside its iframe.
    if (!customer?.name || !customer?.email) {
      setError("Add your name and email to your profile before linking a bank account.");
      return;
    }
    setError(null);
    let Connect: MonoConnectCtor;
    try {
      Connect = await loadConnect();
    } catch {
      setError("Couldn't load the bank-linking widget. Refresh and try again.");
      return;
    }
    const connect = new Connect({
      key: PUBLIC_KEY,
      scope: "auth",
      data: { customer: { name: customer.name, email: customer.email } },
      onSuccess: ({ code }) => {
        openedRef.current = false;
        if (code) void exchange(code);
        else setError("The bank link didn't return an authorisation code.");
      },
      onClose: () => {
        openedRef.current = false;
      },
    });
    connect.setup();
    openedRef.current = true;
    connect.open();
  }

  if (!PUBLIC_KEY) {
    return (
      <p className="text-xs text-text-muted">
        Bank linking isn&apos;t configured on this environment.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <Button type="button" variant="secondary" disabled={!ready || busy} onClick={open}>
        {busy ? "Linking…" : ready ? "Link your salary account" : "Loading…"}
      </Button>
      {error && <p className="text-xs text-error">{error}</p>}
    </div>
  );
}
