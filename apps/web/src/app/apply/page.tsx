"use client";

import { useState } from "react";
import { SiteHeader } from "../../components/site/SiteHeader";
import { Card } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { Input } from "../../components/ui/Field";
import { BriefcaseIcon, CartIcon, CheckIcon } from "../../components/ui/icons";

// Submits to POST /v1/applications (public — apps/api/src/modules/applications).
// Deliberately narrower than the plan's six-step wizard (§11.3): no phone
// OTP, no BVN, no bank linking, no documents — those need Termii/Mono/S3,
// none of which are wired up yet (§9.2's "fake adapters first" approach).
// The steps below are a real progress rail over exactly the fields the API
// accepts today, not a stand-in for the missing ones.
const STEPS = ["Path", "Contact", "Employment", "Review"] as const;

const PATHS = [
  {
    value: "Government",
    icon: BriefcaseIcon,
    title: "Government / Public sector",
    body: "You work for a government ministry, agency, or parastatal.",
    note: "Steadier income tends to strengthen an application — not a guarantee of any specific limit.",
  },
  {
    value: "Private",
    icon: CartIcon,
    title: "Private sector",
    body: "You work for a private company or business.",
    note: "Works the same way — a credit officer reviews every application on its own merits.",
  },
] as const;

interface FormState {
  employmentType: string;
  fullName: string;
  phone: string;
  email: string;
  employer: string;
  jobTitle: string;
  netMonthlySalaryNaira: string;
  salaryDay: string;
  requestedLimitNaira: string;
}

const EMPTY_FORM: FormState = {
  employmentType: "",
  fullName: "",
  phone: "",
  email: "",
  employer: "",
  jobTitle: "",
  netMonthlySalaryNaira: "",
  salaryDay: "",
  requestedLimitNaira: "",
};

export default function ApplyPage() {
  const [step, setStep] = useState(0);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [stepError, setStepError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState<{ reference: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  function update(field: keyof FormState, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  function choosePath(value: string) {
    update("employmentType", value);
    setStepError(null);
    setStep(1);
  }

  function goNext() {
    if (step === 1 && (!form.fullName.trim() || !form.phone.trim())) {
      setStepError("Full name and phone number are required.");
      return;
    }
    setStepError(null);
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  }

  function goBack() {
    setStepError(null);
    setStep((s) => Math.max(s - 1, 0));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.requestedLimitNaira || Number(form.requestedLimitNaira) <= 0) {
      setStepError("Enter how much credit you'd like to request.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/v1/applications`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fullName: form.fullName,
          phone: form.phone,
          email: form.email || undefined,
          employer: form.employer || undefined,
          employmentType: form.employmentType || undefined,
          jobTitle: form.jobTitle || undefined,
          netMonthlySalaryNaira: form.netMonthlySalaryNaira
            ? Number(form.netMonthlySalaryNaira)
            : undefined,
          salaryDay: form.salaryDay ? Number(form.salaryDay) : undefined,
          requestedLimitNaira: Number(form.requestedLimitNaira),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.message ?? "Submission failed");
      setSubmitted({ reference: body.reference });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Submission failed");
    } finally {
      setLoading(false);
    }
  }

  if (submitted) {
    return (
      <>
        <SiteHeader />
        <main className="min-h-screen bg-white px-6 py-16 text-center">
          <Card className="mx-auto max-w-xl p-8">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-primary-surface text-primary">
              <CheckIcon className="h-7 w-7" />
            </div>
            <h1 className="mt-4 text-2xl font-bold text-text-dark">Application submitted</h1>
            <p className="mt-2 text-text-medium">
              Your reference is{" "}
              <span className="rounded-[var(--radius-sm)] bg-gold/15 px-2 py-0.5 font-semibold text-gold-dark">
                {submitted.reference}
              </span>
              . A credit officer will review it shortly.
            </p>
          </Card>
        </main>
      </>
    );
  }

  // Step 0 gets its own wider, card-choice layout — a form shell with a
  // 4-item progress rail would look odd holding just two big buttons.
  if (step === 0) {
    return (
      <>
        <SiteHeader />
        <main className="min-h-screen bg-white px-6 py-16">
          <div className="mx-auto max-w-2xl text-center">
            <h1 className="text-3xl font-bold tracking-tight text-text-dark">Let&apos;s get you a credit limit</h1>
            <p className="mt-2 text-text-medium">How would you like to apply?</p>
          </div>
          <div className="mx-auto mt-10 grid max-w-2xl gap-4 sm:grid-cols-2">
            {PATHS.map(({ value, icon: Icon, title, body, note }) => (
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
                <p className="mt-4 border-t border-dark-border/60 pt-3 text-xs text-text-muted">{note}</p>
              </button>
            ))}
          </div>
          <p className="mt-8 text-center text-xs text-text-muted">
            Not sure? Either works — you can always tell us more on the next steps.
          </p>
        </main>
      </>
    );
  }

  return (
    <>
      <SiteHeader />
      <main className="min-h-screen bg-white px-6 py-16">
        <div className="mx-auto max-w-xl">
          <h1 className="mb-2 text-2xl font-bold tracking-tight text-text-dark">Apply for a credit limit</h1>
          <p className="mb-8 text-text-medium">
            Tell us about yourself and how much you&apos;d like to spend. A credit officer reviews every
            application before a limit goes live.
          </p>

          {/* Progress rail (§11.3) */}
          <ol className="mb-8 flex items-center">
            {STEPS.map((label, i) => {
              const done = i < step;
              const current = i === step;
              return (
                <li key={label} className="flex flex-1 items-center last:flex-none">
                  <div className="flex flex-col items-center gap-1.5">
                    <div
                      className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-semibold transition-colors ${
                        done
                          ? "bg-primary text-white"
                          : current
                            ? "border-2 border-gold bg-gold/10 text-gold-dark"
                            : "border border-dark-border/60 text-text-muted"
                      }`}
                    >
                      {done ? <CheckIcon className="h-4 w-4" /> : i + 1}
                    </div>
                    <span
                      className={`text-xs font-medium ${current ? "text-text-dark" : "text-text-muted"}`}
                    >
                      {label}
                    </span>
                  </div>
                  {i < STEPS.length - 1 && (
                    <div className={`mx-2 h-0.5 flex-1 ${done ? "bg-primary" : "bg-dark-border/40"}`} />
                  )}
                </li>
              );
            })}
          </ol>

          <Card className="p-6">
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              {step === 1 && (
                <>
                  <Input
                    label="Full name"
                    value={form.fullName}
                    onChange={(e) => update("fullName", e.target.value)}
                    required
                  />
                  <Input
                    label="Phone number"
                    value={form.phone}
                    onChange={(e) => update("phone", e.target.value)}
                    required
                  />
                  <Input
                    type="email"
                    label="Email (optional)"
                    value={form.email}
                    onChange={(e) => update("email", e.target.value)}
                  />
                </>
              )}

              {step === 2 && (
                <>
                  <div className="mb-1 flex items-center justify-between rounded-[var(--radius-sm)] bg-surface px-3 py-2 text-xs">
                    <span className="text-text-medium">
                      Applying as <span className="font-semibold text-text-dark">{form.employmentType}</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => setStep(0)}
                      className="font-semibold text-primary hover:underline"
                    >
                      Change
                    </button>
                  </div>
                  <Input
                    label="Employer (optional)"
                    value={form.employer}
                    onChange={(e) => update("employer", e.target.value)}
                  />
                  <Input
                    label="Job title (optional)"
                    value={form.jobTitle}
                    onChange={(e) => update("jobTitle", e.target.value)}
                  />
                  <Input
                    type="number"
                    label="Net monthly salary, ₦ (optional)"
                    value={form.netMonthlySalaryNaira}
                    onChange={(e) => update("netMonthlySalaryNaira", e.target.value)}
                    min={0}
                  />
                  <Input
                    type="number"
                    label="Salary day of month (optional)"
                    value={form.salaryDay}
                    onChange={(e) => update("salaryDay", e.target.value)}
                    min={1}
                    max={31}
                  />
                </>
              )}

              {step === 3 && (
                <>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-[var(--radius-sm)] bg-surface p-4 text-sm">
                    <span className="text-text-muted">Name</span>
                    <span className="text-right font-medium text-text-dark">{form.fullName || "—"}</span>
                    <span className="text-text-muted">Phone</span>
                    <span className="text-right font-medium text-text-dark">{form.phone || "—"}</span>
                    <span className="text-text-muted">Applying as</span>
                    <span className="text-right font-medium text-text-dark">{form.employmentType || "—"}</span>
                    <span className="text-text-muted">Employer</span>
                    <span className="text-right font-medium text-text-dark">{form.employer || "—"}</span>
                    <span className="text-text-muted">Net salary</span>
                    <span className="text-right font-medium text-text-dark">
                      {form.netMonthlySalaryNaira ? `₦${form.netMonthlySalaryNaira}` : "—"}
                    </span>
                  </div>
                  <Input
                    type="number"
                    label="Requested credit limit, ₦"
                    value={form.requestedLimitNaira}
                    onChange={(e) => update("requestedLimitNaira", e.target.value)}
                    min={1}
                    required
                  />
                </>
              )}

              {(stepError || error) && <p className="text-sm text-error">{stepError ?? error}</p>}

              <div className="mt-2 flex items-center justify-between gap-3">
                <Button type="button" variant="ghost" onClick={goBack} disabled={loading}>
                  Back
                </Button>
                {step < STEPS.length - 1 ? (
                  <Button type="button" onClick={goNext}>
                    Continue
                  </Button>
                ) : (
                  <Button type="submit" disabled={loading}>
                    {loading ? "Submitting…" : "Submit application"}
                  </Button>
                )}
              </div>
            </form>
          </Card>
        </div>
      </main>
    </>
  );
}
