"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import styles from "./account.module.css";
import { useRouter } from "next/navigation";
import { SiteHeader } from "../../components/site/SiteHeader";
import { Card, EmptyState } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { Badge } from "../../components/ui/Badge";
import { Input } from "../../components/ui/Field";
import { Tabs } from "../../components/ui/Tabs";
import { formatDate, formatNairaAmount } from "../../lib/format";
import { ORDER_STATUS_TONE, orderStatusLabel } from "../../lib/orders";
import { PASSWORD_HELP, passwordProblem } from "../../lib/password";
import {
  accountFetch,
  clearCustomerSession,
  getCustomerSession,
  patchCustomerSession,
  readError,
  type CustomerSession,
  type VerificationStatus,
} from "../../lib/customer";
import { MonoConnectButton, type BankAnalysis } from "../../components/site/MonoConnectButton";
import { BvnVerifyCard, type IdentityCheck } from "../../components/site/BvnVerifyCard";
import { AutoDebitCard } from "../../components/site/AutoDebitCard";

interface CreditProfile {
  // Deliberately just the tier: the limit, what's used and what's left are
  // enforced server-side at checkout and reviewed in the staff dashboard,
  // but a buyer's own screen shouldn't lead with how much they may owe.
  tier: string;
}

interface OrderItem {
  productId: string;
  name: string;
  quantity: number;
  unitPrice: number;
}

interface Order {
  id: string;
  status: string;
  items: OrderItem[];
  total: number;
  placedAt: string;
  estimatedDelivery: string | null;
  deliverySlot: string | null;
  rejectionReason: string | null;
}

interface Repayment {
  id: string;
  orderId: string;
  amount: number;
  amountPaid: number;
  dueDate: string;
  isPaid: boolean;
  isOverdue: boolean;
  installmentNumber: number;
  totalInstallments: number;
  bnplPlanName: string;
}

const VERIFICATION_COPY: Record<
  VerificationStatus,
  { label: string; tone: "success" | "warning" | "info" | "neutral"; blurb: string }
> = {
  unverified: {
    label: "Not verified",
    tone: "neutral",
    blurb: "Finish the application to unlock a credit limit and checkout.",
  },
  submitted: {
    label: "Under review",
    tone: "info",
    blurb: "A credit officer is checking your details — usually within a working day.",
  },
  needs_more_info: {
    label: "Needs more info",
    tone: "warning",
    blurb: "A reviewer sent your application back — check your email for what to fix.",
  },
  verified: {
    label: "Verified",
    tone: "success",
    blurb: "Your account is verified. Orders you place go straight to review.",
  },
};

interface KycView {
  verificationNote: string | null;
  rejectedDocs: Array<{ kind: string; rejectionReason: string | null }>;
  bankLinkRequested: boolean;
  bankLinked: boolean;
  identityChecked: boolean;
  savedBvnAvailable: boolean;
  // Mono Connect v2 won't open without the customer's email.
  email: string | null;
  fullName: string | null;
}

export default function AccountPage() {
  const router = useRouter();
  const [session, setSession] = useState<CustomerSession | null>(null);
  const [checkedSession, setCheckedSession] = useState(false);
  const [credit, setCredit] = useState<CreditProfile | null>(null);
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [repayments, setRepayments] = useState<Repayment[] | null>(null);
  const [kyc, setKyc] = useState<KycView | null>(null);
  const [bankLinked, setBankLinked] = useState<BankAnalysis | null>(null);
  const [identityChecked, setIdentityChecked] = useState<IdentityCheck | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Emails link here as /account?tab=repayments, so the tab a customer was
  // sent to is the tab they land on. Read from `window` instead of
  // useSearchParams — one string isn't worth a Suspense boundary.
  const [tab, setTab] = useState<string | undefined>(undefined);

  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get("tab");
    if (requested === "orders" || requested === "repayments") setTab(requested);
  }, []);

  useEffect(() => {
    const current = getCustomerSession();
    if (!current) {
      router.replace("/account/login");
      return;
    }
    setSession(current);
    setCheckedSession(true);
  }, [router]);

  useEffect(() => {
    if (!session) return;

    // Best-effort refresh of the verification status shown on this page —
    // mirrors AuthRepository.getCurrentUser()'s pattern on mobile: a stale
    // read is fine, a token that's since been revoked should sign out.
    accountFetch("/v1/auth/customer/me")
      .then(async (res) => {
        if (!res.ok) return;
        const body = await res.json();
        const status = body?.verificationStatus as VerificationStatus | undefined;
        // Only when it actually changed — `session` is this effect's
        // dependency, so storing an equal-but-new object re-runs the fetch,
        // which stores another one, forever.
        if (status && status !== session.verificationStatus) {
          patchCustomerSession({ verificationStatus: status });
          setSession({ ...session, verificationStatus: status });
        }
      })
      .catch(() => {});

    // The reviewer's "what to fix" note + any rejected documents.
    accountFetch("/v1/kyc/me")
      .then(async (res) => {
        if (!res.ok) return;
        const body = await res.json();
        setKyc({
          verificationNote: body?.profile?.verificationNote ?? null,
          rejectedDocs: (body?.documents ?? [])
            .filter((d: { status: string }) => d.status === "rejected")
            .map((d: { kind: string; rejectionReason: string | null }) => ({
              kind: d.kind,
              rejectionReason: d.rejectionReason,
            })),
          bankLinkRequested: !!body?.profile?.bankLinkRequestedAt,
          bankLinked: !!body?.profile?.monoAccountId,
          identityChecked: !!body?.profile?.identityLookup,
          savedBvnAvailable: !!body?.profile?.bvnMashupAvailable,
          email: body?.profile?.email ?? null,
          fullName: body?.profile?.fullName ?? null,
        });
      })
      .catch(() => {});

    accountFetch("/v1/credit/profile")
      .then((res) => (res.ok ? res.json() : null))
      .then(setCredit)
      .catch(() => setCredit(null));

    accountFetch("/v1/orders")
      .then(async (res) => (res.ok ? res.json() : []))
      .then(setOrders)
      .catch(() => setError("Couldn't load your orders."));

    accountFetch("/v1/wallet/repayments")
      .then(async (res) => (res.ok ? res.json() : []))
      .then(setRepayments)
      .catch(() => {});
  }, [session]);

  function handleSignOut() {
    clearCustomerSession();
    router.push("/");
  }

  if (!checkedSession || !session) {
    return (
      <>
        <SiteHeader />
        <main className="min-h-screen bg-white px-6 py-16">
          <p className="mx-auto max-w-5xl text-text-medium">Loading your account…</p>
        </main>
      </>
    );
  }

  const verification = VERIFICATION_COPY[session.verificationStatus] ?? VERIFICATION_COPY.unverified;
  const upcoming = (repayments ?? [])
    .filter((r) => !r.isPaid)
    .sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime());

  return (
    <>
      <SiteHeader />
      <main className={styles.page}>
        <div className={styles.container}>
          <div className={styles.breadcrumb}>Farmer Market <span>/</span> My account</div>
          <section className={styles.hero}>
            <div className={styles.identity}>
              <div className={styles.avatar} aria-hidden="true">{(session.fullName || session.phone).split(" ").map((part) => part[0]).slice(0, 2).join("")}</div>
              <div>
                <p className={styles.eyebrow}>YOUR PERSONAL MARKETPLACE</p>
                <h1>Welcome back, {session.fullName?.split(" ")[0] || "there"}.</h1>
                <p className={styles.heroCopy}>Good food. Flexible payments. Everything in one place.</p>
              </div>
            </div>
            <Link href="/marketplace" className={styles.shopLink}>Browse marketplace <span aria-hidden="true">↗</span></Link>
          </section>
          <div className={styles.summary}>
            <div className={styles.summaryCard}><span className={styles.statIcon} aria-hidden="true">▣</span><div><p>Total orders</p><strong>{orders === null ? "—" : orders.length}</strong><small>Your shopping journey</small></div></div>
            <div className={styles.summaryCard}><span className={styles.statIcon} aria-hidden="true">◷</span><div><p>Upcoming repayments</p><strong>{repayments === null ? "—" : upcoming.length}</strong><small>{upcoming.length ? `Next due ${formatDate(upcoming[0].dueDate)}` : "No payments scheduled"}</small></div></div>
            <div className={styles.summaryCard}><span className={styles.statIcon} aria-hidden="true">✓</span><div><p>Account status</p><strong className={styles.statusValue}>{verification.label}</strong><small>{credit && credit.tier.toLowerCase() !== "none" ? `Tier ${credit.tier}` : "Your Farmer Market account"}</small></div></div>
          </div>
          <div className={styles.workspace}>
          <aside className={styles.profile}>
            <div className={styles.profileAvatar} aria-hidden="true">{(session.fullName || session.phone).slice(0, 1)}</div>
            <h2>{session.fullName || "My account"}</h2>
            <p>{session.phone}</p>
            <Badge tone={verification.tone}>{verification.label}</Badge>
            <div className={styles.profileDivider} />
            <p className={styles.eyebrow}>ACCOUNT OVERVIEW</p>
            <a href="#account-activity" className={styles.sideLink}>Orders & repayments <span aria-hidden="true">↗</span></a>
            <a href="#account-security" className={styles.sideLink}>Password & security <span aria-hidden="true">↗</span></a>
            <div className={styles.profileDivider} />
            <Button variant="ghost" onClick={handleSignOut}>Sign out <span aria-hidden="true">↗</span></Button>
          </aside>
          <div className={styles.content}>
          {/* Verification — the thing that gates everything else, so it leads. */}
          <Card className={`${styles.verification} p-5`}>
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <Badge tone={verification.tone}>{verification.label}</Badge>
                <p className="text-sm text-text-medium">{verification.blurb}</p>
              </div>
              {(session.verificationStatus === "unverified" || session.verificationStatus === "needs_more_info") && (
                <Button variant="secondary" onClick={() => router.push("/apply")}>
                  {session.verificationStatus === "needs_more_info" ? "Update application" : "Continue application"}
                </Button>
              )}
            </div>

            {session.verificationStatus === "needs_more_info" && (kyc?.verificationNote || kyc?.rejectedDocs.length) ? (
              <div className="mt-4 rounded-[var(--radius-sm)] border border-warning/40 bg-warning/10 p-3 text-sm">
                {kyc.verificationNote && (
                  <p className="text-text-dark">
                    <span className="font-semibold">What to fix:</span> {kyc.verificationNote}
                  </p>
                )}
                {kyc.rejectedDocs.length > 0 && (
                  <ul className="mt-2 flex flex-col gap-1 text-text-medium">
                    {kyc.rejectedDocs.map((d, i) => (
                      <li key={i}>
                        <span className="font-medium capitalize text-text-dark">
                          {d.kind.replace(/_/g, " ")}
                        </span>{" "}
                        rejected{d.rejectionReason ? ` — ${d.rejectionReason}` : ""}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ) : null}
          </Card>

          {/* A prior NIN check does not make a legacy hashed BVN recoverable.
              Keep the matching-BVN re-entry flow available for those accounts. */}
          {kyc && (!kyc.identityChecked || !kyc.savedBvnAvailable) && !identityChecked && (
            <section id="bvn-verification" className="scroll-mt-24">
              {!kyc.savedBvnAvailable && <p className="mt-6 text-sm text-text-medium">Please re-enter the BVN already on your application so it can be securely saved for repayment authorization. This does not replace your BVN with a different number or approve a debit mandate.</p>}
              <BvnVerifyCard savedBvnAvailable={kyc.savedBvnAvailable} onVerified={setIdentityChecked} />
            </section>
          )}
          {identityChecked && (
            <Card className="mt-6 p-5">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <Badge
                  tone={
                    identityChecked.verdict === "match"
                      ? "success"
                      : identityChecked.verdict === "partial"
                        ? "warning"
                        : "error"
                  }
                >
                  {identityChecked.verdict === "match" ? "Identity confirmed" : "Identity checked"}
                </Badge>
                {identityChecked.recordName && (
                  <span className="text-text-muted">{identityChecked.recordName}</span>
                )}
              </div>
            </Card>
          )}

          {/* Only shown once a credit officer has actually asked for it —
              never a self-serve, unprompted "link your bank" ask. */}
          {kyc?.bankLinkRequested && !kyc.bankLinked && !bankLinked && (
            <Card className="mt-6 p-5">
              <p className="text-sm font-medium text-text-dark">A credit officer asked you to link your salary account</p>
              <p className="mt-1 text-xs text-text-muted">
                It verifies your income automatically and can speed up your decision. Optional and
                read-only — we can&apos;t move money from it.
              </p>
              <div className="mt-3">
                <MonoConnectButton
                  token={session.token}
                  customer={{
                    name: kyc.fullName || session.fullName || undefined,
                    email: kyc.email || undefined,
                  }}
                  onLinked={setBankLinked}
                />
              </div>
            </Card>
          )}
          {bankLinked && (
            <Card className="mt-6 p-5">
              <div className="flex items-center gap-2 text-sm text-primary">
                <Badge tone="success">Linked</Badge>
                <span>
                  {bankLinked.salaryDetected ? "Salary detected" : "Account linked"}
                  {bankLinked.estimatedMonthlyIncomeKobo != null &&
                    ` · ~₦${Math.round(bankLinked.estimatedMonthlyIncomeKobo / 100).toLocaleString()}/mo`}
                  {bankLinked.institution && ` · ${bankLinked.institution}`}
                </span>
              </div>
            </Card>
          )}

          {upcoming.length > 0 && (
            <Card className="mt-6 p-5">
              <p className="text-sm font-semibold text-text-dark">Next repayment due</p>
              <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="text-xl font-bold tabular-nums text-primary">
                  {formatNairaAmount(upcoming[0].amount - upcoming[0].amountPaid)}
                </span>
                <span className="text-sm text-text-muted">
                  due {formatDate(upcoming[0].dueDate)} · installment {upcoming[0].installmentNumber} of{" "}
                  {upcoming[0].totalInstallments} · {upcoming[0].bnplPlanName}
                </span>
                {upcoming[0].isOverdue && <Badge tone="error">Overdue</Badge>}
              </div>
            </Card>
          )}

          <section id="account-activity" className={styles.activity}>
          <div className={styles.sectionHeading}><div><h2>Your activity</h2><p>Keep track of your orders and payment plans.</p></div><span className={styles.liveDot}>Account overview</span></div>
          <Card className={styles.activityCard}>
            <Tabs
              tabs={[
                { id: "orders", label: "Orders" },
                { id: "repayments", label: "Repayments" },
              ]}
              activeTab={tab ?? "orders"}
              onTabChange={(id) => { setTab(id); window.history.replaceState(null, "", `/account?tab=${id}`); }}
            >
              {(active) =>
                active === "orders" ? (
                  <OrdersPanel orders={orders} error={error} />
                ) : (
                  <>
                    <AutoDebitCard hasTxnPin={session.hasTxnPin} />
                    <RepaymentsPanel repayments={repayments} />
                  </>
                )
              }
            </Tabs>
          </Card>
          </section>
          <details id="account-security" className={styles.security}>
            <summary><span><strong>Password & security</strong><small>Manage your password and keep your account protected.</small></span><span className={styles.securityAction}>Manage <span aria-hidden="true">＋</span></span></summary>
            <ChangePasswordCard />
          </details>
          <p className={styles.footerNote}>Fresh essentials. A little more peace of mind.</p>
          </div>
          </div>
        </div>
      </main>
    </>
  );
}

function OrdersPanel({ orders, error }: { orders: Order[] | null; error: string | null }) {
  if (error) return <p role="alert" className="text-sm text-error">{error}</p>;
  if (orders === null) return <p role="status" className="text-sm text-text-muted">Loading orders…</p>;
  if (orders.length === 0) {
    return <div><EmptyState label="Your next good meal starts here. Place your first order to get started." /><Link href="/marketplace" className={styles.emptyLink}>Explore the marketplace →</Link></div>;
  }

  return (
    <div className={styles.rows}>
      {orders.map((order) => (
        <Link
          key={order.id}
          href={`/account/orders/${order.id}`}
          className={styles.orderRow}
        >
          <div>
            <div className="flex items-center gap-2">
              <p className="font-semibold text-text-dark">
                Order #{order.id.slice(-6).toUpperCase()}
              </p>
              <Badge tone={ORDER_STATUS_TONE[order.status] ?? "neutral"}>
                {orderStatusLabel(order.status)}
              </Badge>
            </div>
            <p className="mt-1 text-xs text-text-muted">
              {order.items.map((i) => `${i.quantity}× ${i.name}`).join(", ")}
            </p>
            <p className="mt-1 text-xs text-text-muted">
              Placed {formatDate(order.placedAt)}
              {order.deliverySlot ? ` · Delivery: ${order.deliverySlot}` : ""}
              {order.rejectionReason ? ` · ${order.rejectionReason}` : ""}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <p className="font-bold tabular-nums text-primary">{formatNairaAmount(order.total)}</p>
            <span aria-hidden className="text-text-muted">
              &rsaquo;
            </span>
          </div>
        </Link>
      ))}
    </div>
  );
}

function RepaymentsPanel({ repayments }: { repayments: Repayment[] | null }) {
  if (repayments === null) return <p className="text-sm text-text-muted">Loading repayments…</p>;
  if (repayments.length === 0) {
    return <EmptyState label="Nothing scheduled — a repayment plan appears here once an order is approved." />;
  }

  return (
    <div className={styles.rows}>
      {repayments.map((r) => (
        <div key={r.id} className="flex flex-wrap items-center justify-between gap-3 py-4">
          <div>
            <div className="flex items-center gap-2">
              <p className="font-semibold text-text-dark">
                Installment {r.installmentNumber} of {r.totalInstallments}
              </p>
              {r.isPaid ? (
                <Badge tone="success">Paid</Badge>
              ) : r.isOverdue ? (
                <Badge tone="error">Overdue</Badge>
              ) : (
                <Badge tone="neutral">Due {formatDate(r.dueDate)}</Badge>
              )}
            </div>
            <p className="mt-1 text-xs text-text-muted">{r.bnplPlanName}</p>
          </div>
          <div className="text-right">
            <p className="font-bold tabular-nums text-text-dark">{formatNairaAmount(r.amount)}</p>
            {r.amountPaid > 0 && !r.isPaid && (
              <p className="text-xs text-text-muted">{formatNairaAmount(r.amountPaid)} paid</p>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function ChangePasswordCard() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    const problem = passwordProblem(next);
    if (problem) {
      setError(problem);
      return;
    }
    if (next !== confirm) {
      setError("The new passwords don't match.");
      return;
    }
    setLoading(true);
    try {
      const res = await accountFetch("/v1/auth/customer/password/change", {
        method: "POST",
        body: JSON.stringify({ currentPassword: current, newPassword: next }),
      });
      if (!res.ok) throw new Error(await readError(res));
      setCurrent("");
      setNext("");
      setConfirm("");
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't change your password.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card className="mt-6 p-5">
      <p className="text-sm font-semibold text-text-dark">Change password</p>
      <form onSubmit={handleSubmit} className="mt-3 grid gap-4 sm:grid-cols-3">
        <Input
          label="Current password"
          type="password"
          autoComplete="current-password"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
          required
        />
        <Input
          label="New password"
          type="password"
          autoComplete="new-password"
          value={next}
          onChange={(e) => setNext(e.target.value)}
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
        <div className="sm:col-span-3">
          <p className="text-xs text-text-muted">{PASSWORD_HELP}</p>
          {error && <p role="alert" className="mt-2 whitespace-pre-line text-sm text-error">{error}</p>}
          {saved && <p role="status" className="mt-2 text-sm text-success">Password changed.</p>}
          <Button type="submit" variant="secondary" disabled={loading} className="mt-3">
            {loading ? "Saving…" : "Change password"}
          </Button>
        </div>
      </form>
    </Card>
  );
}
