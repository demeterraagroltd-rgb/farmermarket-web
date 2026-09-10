"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "../ui/Button";
import { customerFetch, readError } from "../../lib/customer";

const SCRIPT_SRC = "https://connect.withmono.com/connect.js";
const PUBLIC_KEY = process.env.NEXT_PUBLIC_MONO_PUBLIC_KEY;

// Minimal shape of the global the Mono Connect script installs.
interface MonoConnectInstance {
  setup: () => void;
  open: () => void;
}
interface MonoConnectCtor {
  new (config: {
    key: string;
    onSuccess: (payload: { code?: string; getAuthCode?: () => string }) => void;
    onClose?: () => void;
    onLoad?: () => void;
    data?: { customer?: { name?: string; email?: string } };
  }): MonoConnectInstance;
}
declare global {
  interface Window {
    Connect?: MonoConnectCtor;
  }
}

let scriptPromise: Promise<void> | null = null;
function loadScript(): Promise<void> {
  if (typeof window === "undefined") return Promise.reject(new Error("no window"));
  if (window.Connect) return Promise.resolve();
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = SCRIPT_SRC;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Couldn't load the bank-linking widget."));
    document.head.appendChild(s);
  });
  return scriptPromise;
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
    loadScript()
      .then(() => setReady(true))
      .catch((e) => setError(e instanceof Error ? e.message : "Widget failed to load."));
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

  function open() {
    if (!window.Connect || !PUBLIC_KEY || openedRef.current) return;
    setError(null);
    const connect = new window.Connect({
      key: PUBLIC_KEY,
      data: customer ? { customer } : undefined,
      onSuccess: (payload) => {
        openedRef.current = false;
        const code = payload.code ?? payload.getAuthCode?.();
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
