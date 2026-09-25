"use client";

import { useCallback, useEffect, useState } from "react";
import { Card } from "../ui/Card";
import { Button } from "../ui/Button";
import { Badge } from "../ui/Badge";
import { Input } from "../ui/Field";
import { formatDate, formatNairaAmount } from "../../lib/format";
import { accountFetch, readError } from "../../lib/customer";

// The customer's side of automatic repayment: set it up (confirming with their
// transaction PIN, then authorising at their bank on Mono's page), see what it's
// done, and turn it off. Renders nothing at all until the feature is switched on
// server-side, so it can ship dark.

interface AutoDebit {
  available: boolean;
  mandate: {
    status: "awaiting_authorisation" | "approved" | "active" | "paused" | "cancelled" | "rejected" | "expired";
    limit: number;
    collected: number;
    endDate: string;
    authorisationUrl: string | null;
    statusReason: string | null;
  } | null;
  attempts: Array<{
    id: string;
    status: "initiated" | "processing" | "successful" | "failed";
    amount: number;
    installmentNumber: number;
    totalInstallments: number;
    failureReason: string | null;
    at: string;
  }>;
}

const ATTEMPT_LABEL = { initiated: "Sending", processing: "In progress", successful: "Collected", failed: "Didn't go through" } as const;
const ATTEMPT_TONE = { initiated: "neutral", processing: "info", successful: "success", failed: "warning" } as const;

type Action = "start" | "cancel" | null;

export function AutoDebitCard({ hasTxnPin }: { hasTxnPin: boolean }) {
  const [data, setData] = useState<AutoDebit | null>(null);
  const [action, setAction] = useState<Action>(null);
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    accountFetch("/v1/wallet/auto-debit")
      .then(async (res) => (res.ok ? setData(await res.json()) : setData(null)))
      .catch(() => setData(null));
  }, []);
  useEffect(load, [load]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!action) return;
    setBusy(true);
    setError(null);
    try {
      const res = await accountFetch(action === "start" ? "/v1/wallet/auto-debit/mandate" : "/v1/wallet/auto-debit", {
        method: action === "start" ? "POST" : "DELETE",
        body: JSON.stringify({ txnPin: pin }),
      });
      if (!res.ok) {
        const msg = await readError(res);
        throw new Error(msg === "TXN_PIN_NOT_SET" ? "Create your transaction code in the Farmer Market app first, then come back." : msg);
      }
      if (action === "start") {
        const { authorisationUrl } = (await res.json()) as { authorisationUrl: string };
        window.location.href = authorisationUrl; // Mono's page, where they approve it at their bank
        return;
      }
      setAction(null);
      setPin("");
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  if (!data || !data.available) return null;
  const m = data.mandate;
  const live = m && ["awaiting_authorisation", "approved", "active", "paused"].includes(m.status);

  return (
    <Card className="mb-4 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-text-dark">Automatic repayment</p>
          {!live && (
            <p className="mt-1 max-w-xl text-sm text-text-muted">
              Let us collect each installment from your bank account on its due date, so you never miss one. You approve it
              once at your bank, we only take what&apos;s due (never more than the limit you approve), and you can turn it
              off any time.
            </p>
          )}
          {m?.status === "awaiting_authorisation" && (
            <p className="mt-1 max-w-xl text-sm text-text-muted">
              Almost there — approve it at your bank by sending the ₦50 authorisation transfer. This needs to be done
              within an hour of starting.
            </p>
          )}
          {m?.status === "approved" && (
            <p className="mt-1 max-w-xl text-sm text-text-muted">
              Your bank approved it. We&apos;re waiting for final confirmation — this can take a few hours, occasionally
              up to a day.
            </p>
          )}
          {m?.status === "active" && (
            <p className="mt-1 max-w-xl text-sm text-text-muted">
              On. We&apos;ll collect installments on their due dates, up to {formatNairaAmount(m.limit)} in total (
              {formatNairaAmount(m.collected)} so far). Valid until {formatDate(m.endDate)}.
            </p>
          )}
          {m?.status === "paused" && <p className="mt-1 text-sm text-text-muted">Paused — no debits will be taken until it&apos;s resumed.</p>}
          {m && !live && m.status === "rejected" && (
            <p className="mt-1 text-sm text-warning">Your bank didn&apos;t approve it{m.statusReason ? ` (${m.statusReason})` : ""}. You can try again.</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {m && live && <Badge tone={m.status === "active" ? "success" : "info"}>{m.status.replace("_", " ")}</Badge>}
          {m?.status === "awaiting_authorisation" && m.authorisationUrl && (
            <a
              href={m.authorisationUrl}
              className="inline-flex items-center rounded-[var(--radius-sm)] bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-dark"
            >
              Finish at my bank
            </a>
          )}
          {!action && !live && <Button onClick={() => setAction("start")}>Set up</Button>}
          {!action && live && <Button variant="ghost" onClick={() => setAction("cancel")}>Turn off</Button>}
        </div>
      </div>

      {action && (
        <form onSubmit={submit} className="mt-4 flex max-w-sm flex-col gap-3 border-t border-dark-border/60 pt-4">
          <p className="text-sm text-text-medium">
            {action === "start"
              ? "Confirm with your 4-digit transaction code. You'll then be taken to Mono to approve it at your bank."
              : "Confirm with your 4-digit transaction code to turn automatic repayment off. You'll pay installments yourself again."}
          </p>
          {!hasTxnPin && <p className="text-sm text-warning">You haven&apos;t created a transaction code yet — set one in the Farmer Market app first.</p>}
          <Input
            label="Transaction code"
            type="password"
            inputMode="numeric"
            autoComplete="off"
            maxLength={4}
            pattern="\d{4}"
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
            required
          />
          {error && <p className="whitespace-pre-line text-sm text-error">{error}</p>}
          <div className="flex gap-2">
            <Button type="submit" disabled={busy || pin.length !== 4}>
              {busy ? "Working…" : action === "start" ? "Continue to my bank" : "Turn off"}
            </Button>
            <Button type="button" variant="ghost" onClick={() => { setAction(null); setPin(""); setError(null); }}>
              Cancel
            </Button>
          </div>
        </form>
      )}

      {data.attempts.length > 0 && (
        <div className="mt-4 border-t border-dark-border/60 pt-3">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-muted">Recent automatic debits</p>
          <div className="flex flex-col divide-y divide-dark-border/40">
            {data.attempts.slice(0, 5).map((a) => (
              <div key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <span className="text-text-medium">
                  Installment {a.installmentNumber} of {a.totalInstallments} · {formatDate(a.at)}
                </span>
                <span className="flex items-center gap-2">
                  <span className="font-semibold tabular-nums text-text-dark">{formatNairaAmount(a.amount)}</span>
                  <Badge tone={ATTEMPT_TONE[a.status]}>{ATTEMPT_LABEL[a.status]}</Badge>
                </span>
                {a.status === "failed" && a.failureReason && (
                  <span className="w-full text-xs text-text-muted">Because {a.failureReason}. We&apos;ll try again, or you can pay it yourself.</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}
