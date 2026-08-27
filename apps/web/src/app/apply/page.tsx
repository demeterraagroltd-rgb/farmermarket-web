"use client";

import { useState } from "react";
import { Card } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { Input, Select } from "../../components/ui/Field";

// Submits to POST /v1/applications (public — apps/api/src/modules/applications).
// Deliberately narrower than the plan's six-step wizard (§11.3): no phone
// OTP, no BVN, no bank linking, no documents — those need Termii/Mono/S3,
// none of which are wired up yet (§9.2's "fake adapters first" approach).
export default function ApplyPage() {
  const [form, setForm] = useState({
    fullName: "",
    phone: "",
    email: "",
    employer: "",
    employmentType: "",
    jobTitle: "",
    netMonthlySalaryNaira: "",
    requestedLimitNaira: "",
  });
  const [submitted, setSubmitted] = useState<{ reference: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  function update(field: keyof typeof form, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
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
      <main className="mx-auto max-w-xl px-6 py-16 text-center">
        <Card className="p-8">
          <h1 className="text-2xl font-bold text-text-dark">Application submitted</h1>
          <p className="mt-2 text-text-medium">
            Your reference is <span className="font-semibold text-primary">{submitted.reference}</span>.
            A credit officer will review it shortly.
          </p>
        </Card>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-xl px-6 py-16">
      <h1 className="mb-2 text-2xl font-bold tracking-tight text-text-dark">Apply for a credit limit</h1>
      <p className="mb-6 text-text-medium">
        Tell us about yourself and how much you&apos;d like to spend. A credit officer reviews every
        application before a limit goes live.
      </p>
      <Card className="p-6">
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
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
          <Input
            label="Employer (optional)"
            value={form.employer}
            onChange={(e) => update("employer", e.target.value)}
          />
          <Select
            label="Employment type (optional)"
            value={form.employmentType}
            onChange={(e) => update("employmentType", e.target.value)}
          >
            <option value=""></option>
            <option value="Government">Government</option>
            <option value="Private">Private</option>
          </Select>
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
            label="Requested credit limit, ₦"
            value={form.requestedLimitNaira}
            onChange={(e) => update("requestedLimitNaira", e.target.value)}
            min={1}
            required
          />
          {error && <p className="text-sm text-error">{error}</p>}
          <Button type="submit" disabled={loading}>
            {loading ? "Submitting…" : "Submit application"}
          </Button>
        </form>
      </Card>
    </main>
  );
}
