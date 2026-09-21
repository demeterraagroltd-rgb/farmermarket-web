"use client";

import { useState } from "react";
import { apiFetch } from "../../../lib/auth";
import { formatDate, formatDateTime, formatNaira } from "../../../lib/format";
import { EMPLOYMENT_LABEL, EMPLOYMENT_TONE, type Customer360 } from "../../../lib/customer360";
import { Badge } from "../../ui/Badge";
import { Button } from "../../ui/Button";
import { Input, Select } from "../../ui/Field";
import { Row, Section, type TabProps } from "./parts";

type Declared = NonNullable<Customer360["declared"]>;

// Only admins may correct declared facts (the API enforces it; this hides the
// control). Identity-defining fields — name, phone, email, date of birth,
// gender, BVN, NIN — are not editable here at all: they're what the identity
// checks compare against, so editing one would hide a mismatch, not fix it.
const CAN_EDIT = new Set(["super_admin", "admin"]);

function EmploymentEditor({
  customerId,
  declared,
  onSaved,
  onCancel,
}: {
  customerId: string;
  declared: Declared;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [f, setF] = useState({
    employmentType: declared.employmentType ?? "",
    employer: declared.employer ?? "",
    jobTitle: declared.jobTitle ?? "",
    income: declared.declaredMonthlyIncomeKobo == null ? "" : String(declared.declaredMonthlyIncomeKobo / 100),
    salaryDay: declared.salaryDay == null ? "" : String(declared.salaryDay),
    yearsEmployed: declared.yearsEmployed ?? "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof f, v: string) => setF((s) => ({ ...s, [k]: v }));

  async function save() {
    // Send only what actually changed, so an untouched field is never rewritten
    // (and the audit trail records real edits, not resubmissions).
    const body: Record<string, unknown> = {};
    if (f.employmentType && f.employmentType !== (declared.employmentType ?? "")) body.employmentType = f.employmentType;
    if (f.employer.trim() !== (declared.employer ?? "")) body.employer = f.employer.trim();
    if (f.jobTitle.trim() !== (declared.jobTitle ?? "")) body.jobTitle = f.jobTitle.trim();
    if (f.income !== "" && Number(f.income) * 100 !== declared.declaredMonthlyIncomeKobo) {
      body.netMonthlySalaryNaira = Number(f.income);
    }
    if (f.salaryDay !== "" && Number(f.salaryDay) !== declared.salaryDay) body.salaryDay = Number(f.salaryDay);
    if (f.yearsEmployed.trim() !== (declared.yearsEmployed ?? "")) body.yearsEmployed = f.yearsEmployed.trim();

    if (Object.keys(body).length === 0) {
      setError("Nothing has changed.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch(`/v1/admin/customers/${customerId}/profile`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(out.message ?? "Couldn't save changes");
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save changes");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Select label="Employment type" value={f.employmentType} onChange={(e) => set("employmentType", e.target.value)}>
          <option value="">—</option>
          <option value="Government">Government</option>
          <option value="Private">Private</option>
          <option value="Self-employed">Self-employed</option>
        </Select>
        <Input label="Employer" value={f.employer} onChange={(e) => set("employer", e.target.value)} />
        <Input label="Job title" value={f.jobTitle} onChange={(e) => set("jobTitle", e.target.value)} />
        <Input
          label="Monthly income (₦)"
          type="number"
          min={0}
          value={f.income}
          onChange={(e) => set("income", e.target.value)}
        />
        <Input
          label="Salary day (1–31)"
          type="number"
          min={1}
          max={31}
          value={f.salaryDay}
          onChange={(e) => set("salaryDay", e.target.value)}
        />
        <Input label="Years employed" value={f.yearsEmployed} onChange={(e) => set("yearsEmployed", e.target.value)} />
      </div>
      <p className="text-xs text-text-muted">
        Changes are recorded on the audit log with the old and new values. Bank-derived figures aren&apos;t
        recalculated until the bank data is refreshed.
      </p>
      {error && <p className="text-sm text-error">{error}</p>}
      <div className="flex gap-2">
        <Button onClick={save} disabled={busy}>
          {busy ? "Saving…" : "Save changes"}
        </Button>
        <Button variant="ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

export function PersonalTab({ data, reload, role }: TabProps) {
  const [editing, setEditing] = useState(false);
  const d = data.declared;
  const record = (data.identity.latestCheck as { recordName?: string | null } | null)?.recordName ?? null;

  if (!d) {
    return (
      <p className="text-sm text-text-muted">
        This customer has an account but never started a KYC profile, so there&apos;s no personal information on
        file yet.
      </p>
    );
  }

  const addr = d.address;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Section
        title="Personal"
        description="As the customer gave it. Not editable here — the identity checks compare against these."
      >
        <Row label="Full name" value={d.fullName} origin="declared" />
        {record && <Row label="Name on record" value={record} origin="verified" />}
        <Row label="Phone" value={d.phone} origin="declared" />
        <Row label="Email" value={d.email} origin="declared" />
        <Row label="Date of birth" value={d.dateOfBirth ? formatDate(d.dateOfBirth) : null} origin="declared" />
        <Row label="Gender" value={d.gender ? d.gender[0].toUpperCase() + d.gender.slice(1) : null} origin="declared" />
        <Row label="Marital status" value={d.maritalStatus} origin="declared" />
        <Row label="Dependants" value={d.dependantsCount} origin="declared" />
      </Section>

      <Section title="Address" description="Residence, and where the customer is from.">
        <Row label="Street" value={addr?.street} origin="declared" />
        <Row label="City" value={addr?.city} origin="declared" />
        <Row label="State" value={d.state} origin="declared" />
        <Row label="LGA" value={d.lga} origin="declared" />
        <Row label="State of origin" value={d.stateOfOrigin} origin="declared" />
        <Row label="LGA of origin" value={d.lgaOfOrigin} origin="declared" />
      </Section>

      <Section
        title="Employment & income"
        description="What the customer declared — compare with the bank-derived figures on the Financial tab."
        action={
          CAN_EDIT.has(role ?? "") && !editing ? (
            <Button variant="secondary" onClick={() => setEditing(true)}>
              Edit
            </Button>
          ) : undefined
        }
        className="lg:col-span-2"
      >
        {editing ? (
          <EmploymentEditor
            customerId={data.customer.id}
            declared={d}
            onSaved={() => {
              setEditing(false);
              reload();
            }}
            onCancel={() => setEditing(false)}
          />
        ) : (
          <div className="grid gap-x-8 sm:grid-cols-2">
            <div>
              <Row label="Status" value={<Badge tone={EMPLOYMENT_TONE[d.employmentState]}>{EMPLOYMENT_LABEL[d.employmentState]}</Badge>} />
              <Row label="Type" value={d.employmentType} origin="declared" />
              <Row label="Employer" value={d.employer} origin="declared" />
              <Row label="Job title" value={d.jobTitle} origin="declared" />
            </div>
            <div>
              <Row
                label="Monthly income"
                value={d.declaredMonthlyIncomeKobo == null ? null : formatNaira(d.declaredMonthlyIncomeKobo)}
                origin="declared"
              />
              <Row label="Salary day" value={d.salaryDay} origin="declared" />
              <Row label="Years employed" value={d.yearsEmployed} origin="declared" />
              <Row
                label="Credit requested"
                value={d.requestedLimitKobo == null ? null : formatNaira(d.requestedLimitKobo)}
                origin="declared"
              />
            </div>
          </div>
        )}
      </Section>

      <Section title="Next of kin">
        <Row label="Name" value={d.nextOfKin?.name} origin="declared" />
        <Row label="Relationship" value={d.nextOfKin?.relationship} origin="declared" />
        <Row label="Phone" value={d.nextOfKin?.phone} origin="declared" />
      </Section>

      <Section title="Account">
        <Row label="Registered" value={formatDateTime(data.customer.registeredAt)} />
        <Row
          label="Phone verified"
          value={data.customer.phoneVerifiedAt ? formatDateTime(data.customer.phoneVerifiedAt) : "Not verified"}
        />
        <Row label="Customer ID" value={data.customer.id} mono />
      </Section>
    </div>
  );
}
