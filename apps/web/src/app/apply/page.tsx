"use client";

import { useState } from "react";
import Link from "next/link";
import { SiteHeader } from "../../components/site/SiteHeader";
import { Card } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { Input, Select } from "../../components/ui/Field";
import { BriefcaseIcon, CartIcon, LeafIcon, CheckIcon } from "../../components/ui/icons";
import { customerFetch, readError } from "../../lib/customer";

// The full customer KYC onboarding wizard (WEB_APP_PLAN §11.3). It creates the
// account at the "Account" step via POST /v1/auth/customer/register, then
// PATCHes the rest of the profile and uploads documents against /v1/kyc/*
// using the bearer token that register returns (held in component state only —
// §17.6: no ongoing buyer portal on web). Ends on a tracking / get-the-app
// panel; a credit officer picks it up in the dashboard's Verification queue.

const STEP_TITLES = [
  "Personal details",
  "Home address & origin",
  "Employment",
  "Next of kin",
  "Documents",
  "Review & submit",
] as const;
// "Account" is the first counted step (index 0 here → shown as "Step 1 of 7");
// the "Path" screen is step 0 and sits outside this count.
const COUNTED_TITLES = ["Your account", ...STEP_TITLES] as const;
const TOTAL = COUNTED_TITLES.length; // 7

const PATHS = [
  {
    value: "Government",
    icon: BriefcaseIcon,
    title: "Government / Public sector",
    body: "You work for a government ministry, agency, or parastatal.",
  },
  {
    value: "Private",
    icon: CartIcon,
    title: "Private sector",
    body: "You work for a private company or business.",
  },
  {
    value: "Self-employed",
    icon: LeafIcon,
    title: "Self-employed",
    body: "You run your own business or work for yourself.",
  },
] as const;

const DOC_KINDS = [
  { kind: "id_card", label: "Government photo ID", required: true, hint: "ID card, passport, or driver's licence" },
  { kind: "nin_slip", label: "NIN slip", required: false, hint: "Optional" },
  { kind: "employment_letter", label: "Employment letter", required: false, hint: "Helps government-sector applications" },
  { kind: "payslip", label: "Recent payslip", required: false, hint: "Optional" },
  { kind: "utility_bill", label: "Utility bill", required: false, hint: "Proof of address — optional" },
] as const;

interface FormState {
  employmentType: string;
  fullName: string;
  phone: string;
  email: string;
  loginCode: string;
  loginCodeConfirm: string;
  dateOfBirth: string;
  gender: string;
  maritalStatus: string;
  bvn: string;
  nin: string;
  street: string;
  city: string;
  addrState: string;
  lga: string;
  stateOfOrigin: string;
  lgaOfOrigin: string;
  employer: string;
  jobTitle: string;
  netMonthlySalaryNaira: string;
  salaryDay: string;
  requestedLimitNaira: string;
  nokName: string;
  nokRelationship: string;
  nokPhone: string;
}

const EMPTY_FORM: FormState = {
  employmentType: "",
  fullName: "",
  phone: "",
  email: "",
  loginCode: "",
  loginCodeConfirm: "",
  dateOfBirth: "",
  gender: "",
  maritalStatus: "",
  bvn: "",
  nin: "",
  street: "",
  city: "",
  addrState: "",
  lga: "",
  stateOfOrigin: "",
  lgaOfOrigin: "",
  employer: "",
  jobTitle: "",
  netMonthlySalaryNaira: "",
  salaryDay: "",
  requestedLimitNaira: "",
  nokName: "",
  nokRelationship: "",
  nokPhone: "",
};

type DocState = Record<string, { id: string; status: string } | undefined>;

const MAX_DOC_BYTES = 10 * 1024 * 1024;

export default function ApplyPage() {
  const [step, setStep] = useState(0); // 0 = Path; 1..TOTAL = counted steps
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [token, setToken] = useState<string | null>(null);
  const [docs, setDocs] = useState<DocState>({});
  const [uploading, setUploading] = useState<string | null>(null);
  const [consents, setConsents] = useState({ credit: false, data: false, terms: false });
  const [stepError, setStepError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  function update(field: keyof FormState, value: string) {
    setForm((p) => ({ ...p, [field]: value }));
  }

  function choosePath(value: string) {
    update("employmentType", value);
    setStepError(null);
    setStep(1);
  }

  async function patchProfile(partial: Record<string, unknown>) {
    if (!token) return;
    const res = await customerFetch("/v1/kyc/me", token, {
      method: "PATCH",
      body: JSON.stringify(partial),
    });
    if (!res.ok) throw new Error(await readError(res));
  }

  // Advance from a counted step. Validates, persists, moves on.
  async function goNext() {
    setStepError(null);
    setLoading(true);
    try {
      if (step === 1) {
        // Account — create it.
        if (!form.fullName.trim() || !form.phone.trim() || !form.email.trim()) {
          throw new Error("Full name, phone and email are required.");
        }
        if (!/^\d{6}$/.test(form.loginCode)) throw new Error("Your login code must be 6 digits.");
        if (form.loginCode !== form.loginCodeConfirm) throw new Error("The login codes don't match.");
        const res = await customerFetch("/v1/auth/customer/register", "", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            fullName: form.fullName.trim(),
            phone: form.phone.trim(),
            email: form.email.trim(),
            loginCode: form.loginCode,
            employmentType: form.employmentType || undefined,
          }),
        });
        if (!res.ok) throw new Error(await readError(res));
        const body = await res.json();
        setToken(body.accessToken as string);
      } else if (step === 2) {
        if (!form.dateOfBirth) throw new Error("Your date of birth is required.");
        if (!/^\d{11}$/.test(form.bvn)) throw new Error("Enter your 11-digit BVN.");
        if (form.nin && !/^\d{11}$/.test(form.nin)) throw new Error("NIN must be 11 digits.");
        await patchProfile({
          dateOfBirth: form.dateOfBirth,
          gender: form.gender || undefined,
          maritalStatus: form.maritalStatus || undefined,
          bvn: form.bvn,
          nin: form.nin || undefined,
        });
      } else if (step === 3) {
        if (!form.street.trim() || !form.city.trim() || !form.addrState.trim() || !form.lga.trim()) {
          throw new Error("Your full residential address is required.");
        }
        if (!form.stateOfOrigin.trim() || !form.lgaOfOrigin.trim()) {
          throw new Error("Your state and LGA of origin are required.");
        }
        await patchProfile({
          residentialAddress: {
            street: form.street.trim(),
            city: form.city.trim(),
            state: form.addrState.trim(),
            lga: form.lga.trim(),
          },
          stateOfOrigin: form.stateOfOrigin.trim(),
          lgaOfOrigin: form.lgaOfOrigin.trim(),
        });
      } else if (step === 4) {
        await patchProfile({
          employmentType: form.employmentType || undefined,
          employer: form.employer.trim() || undefined,
          jobTitle: form.jobTitle.trim() || undefined,
          netMonthlySalaryNaira: form.netMonthlySalaryNaira
            ? Number(form.netMonthlySalaryNaira)
            : undefined,
          salaryDay: form.salaryDay ? Number(form.salaryDay) : undefined,
          requestedLimitNaira: form.requestedLimitNaira
            ? Number(form.requestedLimitNaira)
            : undefined,
        });
        // TODO(mono): a "Link salary account" step slots in here — Mono Connect
        // widget → exchange code → PATCH monoAccountId + verified income.
      } else if (step === 5) {
        if (form.nokName.trim() || form.nokRelationship.trim() || form.nokPhone.trim()) {
          await patchProfile({
            nextOfKin: {
              name: form.nokName.trim(),
              relationship: form.nokRelationship.trim(),
              phone: form.nokPhone.trim(),
            },
          });
        }
      } else if (step === 6) {
        if (!docs.id_card) throw new Error("A government photo ID is required.");
      }
      setStep((s) => Math.min(s + 1, TOTAL));
    } catch (err) {
      setStepError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  function goBack() {
    setStepError(null);
    setStep((s) => Math.max(s - 1, 0));
  }

  async function uploadDoc(kind: string, file: File) {
    if (!token) return;
    if (file.size > MAX_DOC_BYTES) {
      setStepError("That file is larger than 10 MB.");
      return;
    }
    setStepError(null);
    setUploading(kind);
    try {
      const fd = new FormData();
      fd.append("kind", kind);
      fd.append("file", file);
      const res = await customerFetch("/v1/kyc/documents", token, { method: "POST", body: fd });
      if (!res.ok) throw new Error(await readError(res));
      const body = await res.json();
      setDocs((d) => ({ ...d, [kind]: { id: body.id, status: body.status ?? "pending" } }));
    } catch (err) {
      setStepError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setUploading(null);
    }
  }

  async function handleSubmit() {
    if (!token) return;
    if (!consents.credit || !consents.data || !consents.terms) {
      setStepError("Please tick all three consents to continue.");
      return;
    }
    setStepError(null);
    setLoading(true);
    try {
      const res = await customerFetch("/v1/kyc/submit", token, { method: "POST" });
      if (!res.ok) throw new Error(await readError(res));
      setSubmitted(true);
    } catch (err) {
      setStepError(err instanceof Error ? err.message : "Submission failed.");
    } finally {
      setLoading(false);
    }
  }

  // ---- success ---------------------------------------------------------
  if (submitted) {
    return (
      <>
        <SiteHeader />
        <main className="min-h-screen bg-white px-6 py-16">
          <Card className="mx-auto max-w-xl p-8 text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-primary-surface text-primary">
              <CheckIcon className="h-7 w-7" />
            </div>
            <h1 className="mt-4 text-2xl font-bold text-text-dark">We&apos;re reviewing your application</h1>
            <p className="mt-2 text-text-medium">
              A credit officer will check your details and documents — usually within a working day.
              You&apos;ll get an email as soon as there&apos;s an update.
            </p>
            <div className="mt-6 rounded-[var(--radius-lg)] bg-surface p-4 text-left text-sm text-text-medium">
              <p className="font-semibold text-text-dark">What happens next</p>
              <p className="mt-1">
                Once you&apos;re verified, you manage your credit, orders and repayments in the
                Farmer Market app — that&apos;s where everything lives from here.
              </p>
            </div>
            <Link
              href="/"
              className="mt-6 inline-flex items-center justify-center rounded-[var(--radius-sm)] bg-primary px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-primary-dark"
            >
              Get the app
            </Link>
          </Card>
        </main>
      </>
    );
  }

  // ---- step 0: path choice -------------------------------------------
  if (step === 0) {
    return (
      <>
        <SiteHeader />
        <main className="min-h-screen bg-white px-6 py-16">
          <div className="mx-auto max-w-2xl text-center">
            <h1 className="text-3xl font-bold tracking-tight text-text-dark">Let&apos;s get you verified</h1>
            <p className="mt-2 text-text-medium">
              A few minutes of details and documents. How would you like to apply?
            </p>
          </div>
          <div className="mx-auto mt-10 grid max-w-3xl gap-4 sm:grid-cols-3">
            {PATHS.map(({ value, icon: Icon, title, body }) => (
              <button
                key={value}
                type="button"
                onClick={() => choosePath(value)}
                className="group flex flex-col rounded-[var(--radius-lg)] border-2 border-dark-border/60 bg-white p-6 text-left transition-all hover:-translate-y-1 hover:border-primary hover:shadow-[var(--shadow-card)]"
              >
                <div className="flex h-11 w-11 items-center justify-center rounded-[var(--radius-sm)] bg-primary-surface text-primary transition-colors group-hover:bg-primary group-hover:text-white">
                  <Icon className="h-5 w-5" />
                </div>
                <h2 className="mt-4 font-semibold text-text-dark">{title}</h2>
                <p className="mt-1.5 text-sm text-text-medium">{body}</p>
              </button>
            ))}
          </div>
          <p className="mx-auto mt-8 max-w-2xl text-center text-xs text-text-muted">
            Your BVN is hashed, never stored in the clear. Documents are private and only a credit
            officer can open them.
          </p>
        </main>
      </>
    );
  }

  // ---- counted steps 1..TOTAL --------------------------------------
  const title = COUNTED_TITLES[step - 1];
  const pct = Math.round((step / TOTAL) * 100);

  return (
    <>
      <SiteHeader />
      <main className="min-h-screen bg-white px-6 py-14">
        <div className="mx-auto max-w-xl">
          <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">
            Step {step} of {TOTAL}
          </p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-text-dark">{title}</h1>
          <div className="mt-4 h-1.5 w-full overflow-hidden rounded-full bg-dark-border/30">
            <div
              className="h-full rounded-full bg-primary transition-all duration-300"
              style={{ width: `${pct}%` }}
            />
          </div>

          <Card className="mt-6 p-6">
            <div className="flex flex-col gap-4">
              {step === 1 && (
                <>
                  <Input label="Full name" value={form.fullName} onChange={(e) => update("fullName", e.target.value)} required />
                  <Input label="Phone number" value={form.phone} onChange={(e) => update("phone", e.target.value)} required />
                  <Input type="email" label="Email" value={form.email} onChange={(e) => update("email", e.target.value)} required />
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Input
                      label="6-digit login code"
                      inputMode="numeric"
                      maxLength={6}
                      value={form.loginCode}
                      onChange={(e) => update("loginCode", e.target.value.replace(/\D/g, ""))}
                    />
                    <Input
                      label="Confirm login code"
                      inputMode="numeric"
                      maxLength={6}
                      value={form.loginCodeConfirm}
                      onChange={(e) => update("loginCodeConfirm", e.target.value.replace(/\D/g, ""))}
                    />
                  </div>
                  <p className="text-xs text-text-muted">
                    You&apos;ll use your phone number and this code to sign in to the app.
                  </p>
                </>
              )}

              {step === 2 && (
                <>
                  <Input type="date" label="Date of birth" value={form.dateOfBirth} onChange={(e) => update("dateOfBirth", e.target.value)} required />
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Select label="Gender" value={form.gender} onChange={(e) => update("gender", e.target.value)}>
                      <option value="">Prefer not to say</option>
                      <option value="male">Male</option>
                      <option value="female">Female</option>
                      <option value="other">Other</option>
                    </Select>
                    <Select label="Marital status" value={form.maritalStatus} onChange={(e) => update("maritalStatus", e.target.value)}>
                      <option value="">Prefer not to say</option>
                      <option value="single">Single</option>
                      <option value="married">Married</option>
                      <option value="divorced">Divorced</option>
                      <option value="widowed">Widowed</option>
                    </Select>
                  </div>
                  <Input
                    label="BVN"
                    inputMode="numeric"
                    maxLength={11}
                    value={form.bvn}
                    onChange={(e) => update("bvn", e.target.value.replace(/\D/g, ""))}
                    required
                  />
                  <Input
                    label="NIN (optional — you can add this later)"
                    inputMode="numeric"
                    maxLength={11}
                    value={form.nin}
                    onChange={(e) => update("nin", e.target.value.replace(/\D/g, ""))}
                  />
                </>
              )}

              {step === 3 && (
                <>
                  <Input label="Street address" value={form.street} onChange={(e) => update("street", e.target.value)} required />
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Input label="City / town" value={form.city} onChange={(e) => update("city", e.target.value)} required />
                    <Input label="LGA of residence" value={form.lga} onChange={(e) => update("lga", e.target.value)} required />
                  </div>
                  <Input label="State of residence" value={form.addrState} onChange={(e) => update("addrState", e.target.value)} required />
                  <hr className="border-dark-border/40" />
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Input label="State of origin" value={form.stateOfOrigin} onChange={(e) => update("stateOfOrigin", e.target.value)} required />
                    <Input label="LGA of origin" value={form.lgaOfOrigin} onChange={(e) => update("lgaOfOrigin", e.target.value)} required />
                  </div>
                </>
              )}

              {step === 4 && (
                <>
                  <div className="mb-1 flex items-center justify-between rounded-[var(--radius-sm)] bg-surface px-3 py-2 text-xs">
                    <span className="text-text-medium">
                      Applying as <span className="font-semibold text-text-dark">{form.employmentType}</span>
                    </span>
                    <button type="button" onClick={() => setStep(0)} className="font-semibold text-primary hover:underline">
                      Change
                    </button>
                  </div>
                  <Input label="Employer (optional)" value={form.employer} onChange={(e) => update("employer", e.target.value)} />
                  <Input label="Job title (optional)" value={form.jobTitle} onChange={(e) => update("jobTitle", e.target.value)} />
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Input type="number" label="Net monthly salary, ₦ (optional)" value={form.netMonthlySalaryNaira} onChange={(e) => update("netMonthlySalaryNaira", e.target.value)} min={0} />
                    <Input type="number" label="Salary day of month (optional)" value={form.salaryDay} onChange={(e) => update("salaryDay", e.target.value)} min={1} max={31} />
                  </div>
                  <Input type="number" label="How much credit would you like? ₦ (optional)" value={form.requestedLimitNaira} onChange={(e) => update("requestedLimitNaira", e.target.value)} min={0} />
                </>
              )}

              {step === 5 && (
                <>
                  <p className="text-sm text-text-muted">Someone we can reach in an emergency. Optional.</p>
                  <Input label="Full name" value={form.nokName} onChange={(e) => update("nokName", e.target.value)} />
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Input label="Relationship" value={form.nokRelationship} onChange={(e) => update("nokRelationship", e.target.value)} />
                    <Input label="Phone" value={form.nokPhone} onChange={(e) => update("nokPhone", e.target.value)} />
                  </div>
                </>
              )}

              {step === 6 && (
                <>
                  <p className="text-sm text-text-muted">
                    A government photo ID is required. The rest help your application, especially for
                    government-sector workers. Images or PDF, up to 10 MB each.
                  </p>
                  {DOC_KINDS.map(({ kind, label, required, hint }) => {
                    const d = docs[kind];
                    return (
                      <div
                        key={kind}
                        className="flex items-center justify-between gap-3 rounded-[var(--radius-sm)] border border-dark-border/60 p-3"
                      >
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-text-dark">
                            {label}
                            {required && <span className="text-error"> *</span>}
                          </p>
                          <p className="text-xs text-text-muted">{d ? `Uploaded — ${d.status}` : hint}</p>
                        </div>
                        <label className="shrink-0 cursor-pointer rounded-[var(--radius-sm)] border border-dark-border/60 px-3 py-1.5 text-xs font-semibold text-text-medium hover:bg-surface">
                          {uploading === kind ? "Uploading…" : d ? "Replace" : "Upload"}
                          <input
                            type="file"
                            accept="image/*,application/pdf"
                            className="hidden"
                            disabled={uploading !== null}
                            onChange={(e) => {
                              const f = e.target.files?.[0];
                              if (f) uploadDoc(kind, f);
                              e.target.value = "";
                            }}
                          />
                        </label>
                      </div>
                    );
                  })}
                </>
              )}

              {step === 7 && (
                <>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-[var(--radius-sm)] bg-surface p-4 text-sm">
                    <span className="text-text-muted">Name</span>
                    <span className="text-right font-medium text-text-dark">{form.fullName || "—"}</span>
                    <span className="text-text-muted">Phone</span>
                    <span className="text-right font-medium text-text-dark">{form.phone || "—"}</span>
                    <span className="text-text-muted">Applying as</span>
                    <span className="text-right font-medium text-text-dark">{form.employmentType || "—"}</span>
                    <span className="text-text-muted">Date of birth</span>
                    <span className="text-right font-medium text-text-dark">{form.dateOfBirth || "—"}</span>
                    <span className="text-text-muted">BVN</span>
                    <span className="text-right font-medium text-text-dark">
                      {form.bvn ? `•••• ${form.bvn.slice(-4)}` : "—"}
                    </span>
                    <span className="text-text-muted">Residence</span>
                    <span className="text-right font-medium text-text-dark">
                      {[form.street, form.city, form.lga, form.addrState].filter(Boolean).join(", ") || "—"}
                    </span>
                    <span className="text-text-muted">Documents</span>
                    <span className="text-right font-medium text-text-dark">
                      {Object.keys(docs).length} uploaded
                    </span>
                  </div>
                  <div className="flex flex-col gap-2.5 text-sm text-text-medium">
                    <label className="flex items-start gap-2">
                      <input type="checkbox" className="mt-0.5 accent-primary" checked={consents.credit} onChange={(e) => setConsents((c) => ({ ...c, credit: e.target.checked }))} />
                      <span>I consent to a credit and identity check using the details I&apos;ve provided.</span>
                    </label>
                    <label className="flex items-start gap-2">
                      <input type="checkbox" className="mt-0.5 accent-primary" checked={consents.data} onChange={(e) => setConsents((c) => ({ ...c, data: e.target.checked }))} />
                      <span>I consent to Farmer Market processing my personal data to assess this application.</span>
                    </label>
                    <label className="flex items-start gap-2">
                      <input type="checkbox" className="mt-0.5 accent-primary" checked={consents.terms} onChange={(e) => setConsents((c) => ({ ...c, terms: e.target.checked }))} />
                      <span>I agree to the Terms of Service and Privacy Policy.</span>
                    </label>
                  </div>
                </>
              )}

              {stepError && <p className="text-sm text-error">{stepError}</p>}

              <div className="mt-2 flex items-center justify-between gap-3">
                <Button type="button" variant="ghost" onClick={goBack} disabled={loading}>
                  Back
                </Button>
                {step < TOTAL ? (
                  <Button type="button" onClick={goNext} disabled={loading || uploading !== null}>
                    {loading ? "Saving…" : "Continue"}
                  </Button>
                ) : (
                  <Button type="button" onClick={handleSubmit} disabled={loading}>
                    {loading ? "Submitting…" : "Submit for verification"}
                  </Button>
                )}
              </div>
            </div>
          </Card>
        </div>
      </main>
    </>
  );
}
