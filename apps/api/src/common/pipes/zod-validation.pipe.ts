import { BadRequestException, type PipeTransform } from "@nestjs/common";
import type { ZodIssue, ZodSchema } from "zod";

// One definition of "valid input", enforced server-side too, mirroring the
// same Zod schemas the web forms use (§3, "Forms" row).
//
// Zod's own messages name a *type*, not a field — "Number must be less than
// or equal to 31" tells an applicant nothing about which box to fix. Every
// message that leaves this pipe therefore names the field in the same words
// the form's label uses, and *all* the failures come back at once rather than
// one per round-trip.

/**
 * Field path → the label the user actually sees on the form. Keep these in
 * step with the web `/apply` wizard and the Flutter sign-up screens; an
 * unmapped path falls back to a de-camel-cased version of the path itself,
 * which reads acceptably ("stateOfOrigin" → "State of origin") but is worth
 * replacing with real wording as fields are added.
 */
const FIELD_LABELS: Record<string, string> = {
  // Account / identity
  fullName: "Full name",
  phone: "Phone number",
  email: "Email address",
  loginCode: "Login code",
  code: "Login code",
  password: "Password",
  pin: "Transaction code",
  txnPin: "Transaction code",
  totpCode: "Authenticator code",
  dateOfBirth: "Date of birth",
  gender: "Gender",
  maritalStatus: "Marital status",
  dependantsCount: "Number of dependants",
  bvn: "BVN",
  nin: "NIN",
  // Address
  "residentialAddress.street": "Street address",
  "residentialAddress.city": "City / town",
  "residentialAddress.state": "State of residence",
  "residentialAddress.lga": "LGA of residence",
  residentialAddress: "Residential address",
  stateOfOrigin: "State of origin",
  lgaOfOrigin: "LGA of origin",
  // Next of kin
  "nextOfKin.name": "Next of kin's full name",
  "nextOfKin.relationship": "Next of kin's relationship to you",
  "nextOfKin.phone": "Next of kin's phone number",
  nextOfKin: "Next of kin",
  // Employment & income
  employmentType: "Employment type",
  employer: "Employer",
  jobTitle: "Job title",
  yearsEmployed: "Years employed",
  netMonthlySalaryNaira: "Net monthly salary",
  salaryDay: "Salary day of the month",
  requestedLimitNaira: "Requested credit limit",
  bankName: "Bank name",
  accountNumber: "Account number",
  // Orders / catalog / ops
  items: "Order items",
  productId: "Product",
  quantity: "Quantity",
  deliveryAddress: "Delivery address",
  bnplPlanId: "Repayment plan",
  deliverySlot: "Delivery slot",
  status: "Status",
  reason: "Reason",
  rejectionReason: "Reason",
  note: "Note",
  decision: "Decision",
  kind: "Document type",
  amountNaira: "Amount",
  repaymentScheduleId: "Repayment",
};

/** "netMonthlySalaryNaira" → "Net monthly salary naira" — the last-resort label. */
function humanizePath(path: string): string {
  const words = path
    .split(".")
    .pop()!
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function labelFor(issue: ZodIssue): string {
  // Array elements: "items.0.quantity" → look up "items.quantity", and say
  // which one it was ("Quantity for item 1").
  const path = issue.path.map(String);
  const dotted = path.join(".");
  if (FIELD_LABELS[dotted]) return FIELD_LABELS[dotted];

  const withoutIndexes = path.filter((p) => !/^\d+$/.test(p)).join(".");
  const base = FIELD_LABELS[withoutIndexes] ?? FIELD_LABELS[path[path.length - 1]];
  const index = path.find((p) => /^\d+$/.test(p));
  const label = base ?? humanizePath(dotted || "value");
  return index === undefined ? label : `${label} for item ${Number(index) + 1}`;
}

/**
 * Zod's stock wording for the codes we rewrite. If an issue's message isn't
 * one of these, a schema author wrote it deliberately (e.g. "BVN must be 11
 * digits") and it's used verbatim — those already name their field.
 */
function isZodDefaultMessage(message: string): boolean {
  return (
    message === "Required" ||
    message === "Invalid" ||
    message === "Invalid email" ||
    message === "Invalid date" ||
    message === "Invalid url" ||
    message === "Invalid uuid" ||
    /^Expected .+, received .+$/.test(message) ||
    /^(String|Number|Array|Set) must contain /.test(message) ||
    /^Number must be (greater|less) than /.test(message) ||
    /^Invalid enum value\./.test(message) ||
    /^Invalid literal value/.test(message) ||
    /^Unrecognized key/.test(message)
  );
}

function sentenceFor(issue: ZodIssue): string {
  const label = labelFor(issue);

  // Deliberate, field-aware wording from the schema wins — don't second-guess it.
  if (!isZodDefaultMessage(issue.message)) return issue.message;

  switch (issue.code) {
    case "invalid_type":
      return issue.received === "undefined" || issue.received === "null"
        ? `${label} is required.`
        : `${label} must be a ${issue.expected}.`;

    case "too_small": {
      const min = issue.minimum;
      if (issue.type === "string") {
        return min === 1
          ? `${label} is required.`
          : `${label} must be at least ${min} characters.`;
      }
      if (issue.type === "array") {
        return min === 1 ? `${label} cannot be empty.` : `${label} needs at least ${min} entries.`;
      }
      return issue.inclusive
        ? `${label} must be ${min} or more.`
        : `${label} must be more than ${min}.`;
    }

    case "too_big": {
      const max = issue.maximum;
      if (issue.type === "string") return `${label} must be at most ${max} characters.`;
      if (issue.type === "array") return `${label} can have at most ${max} entries.`;
      return issue.inclusive
        ? `${label} must be ${max} or less.`
        : `${label} must be less than ${max}.`;
    }

    case "invalid_string":
      if (issue.validation === "email") return `${label} must be a valid email address.`;
      if (issue.validation === "url") return `${label} must be a valid web address.`;
      if (issue.validation === "uuid") return `${label} is not valid.`;
      return `${label} is not in the expected format.`;

    case "invalid_enum_value":
      return `${label} must be one of: ${issue.options.join(", ")}.`;

    case "invalid_date":
      return `${label} must be a valid date.`;

    case "unrecognized_keys":
      return `These fields are not recognised: ${issue.keys.join(", ")}.`;

    default:
      return `${label}: ${issue.message}`;
  }
}

export class ZodValidationPipe implements PipeTransform {
  constructor(private readonly schema: ZodSchema) {}

  transform(value: unknown) {
    const result = this.schema.safeParse(value);
    if (result.success) return result.data;

    // Field-keyed, for a form that wants to highlight the offending inputs…
    const fieldErrors: Record<string, string[]> = {};
    const formErrors: string[] = [];
    for (const issue of result.error.issues) {
      const sentence = sentenceFor(issue);
      const key = issue.path.map(String).join(".");
      if (key) (fieldErrors[key] ??= []).push(sentence);
      else formErrors.push(sentence);
    }

    // …and one ready-to-show string, because that's what both clients read
    // first (web `readError`, Flutter `ApiException._messageFromResponse`).
    // Every failure, not just the first — otherwise fixing one field only
    // reveals the next one on the following submit.
    const message = [...formErrors, ...Object.values(fieldErrors).flat()].join("\n");

    throw new BadRequestException({
      statusCode: 400,
      error: "Bad Request",
      message,
      fieldErrors,
      formErrors,
    });
  }
}
