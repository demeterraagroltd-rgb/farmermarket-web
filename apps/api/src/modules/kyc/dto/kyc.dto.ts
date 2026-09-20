import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { canonicalLga, canonicalState } from "@farmermarket/core";
import { z } from "zod";
import { passwordSchema } from "../../../common/password";

export const DOCUMENT_KINDS = [
  "id_card",
  "passport",
  "drivers_license",
  "nin_slip",
  "employment_letter",
  "payslip",
  "utility_bill",
  "bank_statement",
  "other",
] as const;

// State/LGA arrive from a dropdown fed by GET /v1/config/locations, so a value
// that isn't on the list means a stale client or a hand-rolled request. Either
// way, reject it rather than store a fourth spelling of the same place.
// Canonicalising here (not just validating) means loose-but-real input from the
// Flutter app or an older web bundle still lands as the official spelling.
const stateSchema = z
  .string()
  .min(1)
  .transform((value, ctx) => {
    const canonical = canonicalState(value);
    if (!canonical) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Pick a state from the list.",
      });
      return z.NEVER;
    }
    return canonical;
  });

// `state` and `lga` always travel together, so the pair is validated as a unit
// — an LGA name is only meaningful within its state (several recur across
// states), and this is what stops a plausible-but-wrong pairing.
const addressSchema = z
  .object({
    street: z.string().min(1),
    city: z.string().min(1),
    state: z.string().min(1),
    lga: z.string().min(1),
  })
  .transform((address, ctx) => {
    const state = canonicalState(address.state);
    const lga = canonicalLga(address.state, address.lga);
    if (!state) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["state"],
        message: "Pick a state from the list.",
      });
    }
    if (!lga) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["lga"],
        message: "Pick an LGA from the list for that state.",
      });
    }
    if (!state || !lga) return z.NEVER;
    return { ...address, state, lga };
  });

const nextOfKinSchema = z.object({
  name: z.string().min(1),
  relationship: z.string().min(1),
  phone: z.string().min(1),
});

// The profile fields, all optional — used both for PATCH /v1/kyc/me and,
// merged with the login fields below, for POST /v1/auth/customer/register.
export const kycProfileFields = {
  fullName: z.string().min(1).optional(),
  dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD").optional(),
  gender: z.enum(["male", "female", "other"]).optional(),
  maritalStatus: z.enum(["single", "married", "divorced", "widowed"]).optional(),
  dependantsCount: z.number().int().min(0).max(30).optional(),
  bvn: z.string().regex(/^\d{11}$/, "BVN must be 11 digits").optional(),
  // Optional here (this schema also backs partial PATCH /kyc/me updates) —
  // required by the time of POST /kyc/submit, enforced in
  // KycService.REQUIRED_PROFILE_FIELDS, same pattern as bvn below.
  nin: z.string().regex(/^\d{11}$/, "NIN must be 11 digits").optional(),
  email: z.string().email().optional(),
  residentialAddress: addressSchema.optional(),
  stateOfOrigin: stateSchema.optional(),
  // Canonicalised against the state in KycService.buildProfileWrite, which is
  // where both halves of the pair are visible — a partial PATCH may carry only
  // one of them. The pair itself is re-checked at submission.
  lgaOfOrigin: z.string().min(1).transform((v) => v.trim()).optional(),
  nextOfKin: nextOfKinSchema.optional(),
  // Employment details are required by submission time — see
  // KycService.REQUIRED_PROFILE_FIELDS. They stay optional in this schema
  // because it also backs partial PATCH /kyc/me updates, but `.min(1)` means
  // an empty string is never silently accepted as "filled in".
  employmentType: z.enum(["Government", "Private", "Self-employed"]).optional(),
  employer: z.string().trim().min(1, "Employer is required.").optional(),
  jobTitle: z.string().trim().min(1, "Job title is required.").optional(),
  netMonthlySalaryNaira: z.number().positive().optional(),
  salaryDay: z.number().int().min(1).max(31).optional(),
  yearsEmployed: z.string().optional(),
  bankName: z.string().optional(),
  accountNumber: z.string().regex(/^\d{10}$/, "Account number must be 10 digits").optional(),
  requestedLimitNaira: z.number().positive().optional(),
} as const;

export const updateKycSchema = z.object(kycProfileFields);
export type UpdateKycInput = z.infer<typeof updateKycSchema>;

// Registration = login credentials + as much of the profile as they filled.
// Profile fields first so the required login fields below win the merge.
export const registerSchema = z.object({
  ...kycProfileFields,
  fullName: z.string().min(1),
  phone: z.string().min(6),
  email: z.string().email(),
  password: passwordSchema,
  // Proof the phone was verified by SMS (POST /v1/auth/customer/otp/verify).
  // Optional at the schema level while no SMS sender is approved; enforced by
  // KycService when PHONE_VERIFICATION_REQUIRED=true.
  phoneVerificationToken: z.string().min(1).optional(),
});
export type RegisterInput = z.infer<typeof registerSchema>;

export class RegisterDto {
  @ApiProperty() fullName!: string;
  @ApiProperty() phone!: string;
  @ApiProperty() email!: string;
  @ApiProperty({ description: "At least 8 characters, letters and numbers" }) password!: string;
  @ApiPropertyOptional({ description: "Token from POST /auth/customer/otp/verify" })
  phoneVerificationToken?: string;
  @ApiPropertyOptional() dateOfBirth?: string;
  @ApiPropertyOptional() gender?: string;
  @ApiPropertyOptional() maritalStatus?: string;
  @ApiPropertyOptional() dependantsCount?: number;
  @ApiPropertyOptional({ description: "11-digit BVN" }) bvn?: string;
  @ApiPropertyOptional({ description: "11-digit NIN — required by submission time" }) nin?: string;
  @ApiPropertyOptional({ type: Object }) residentialAddress?: unknown;
  @ApiPropertyOptional() stateOfOrigin?: string;
  @ApiPropertyOptional() lgaOfOrigin?: string;
  @ApiPropertyOptional({ type: Object }) nextOfKin?: unknown;
  @ApiPropertyOptional() employmentType?: string;
  @ApiPropertyOptional() employer?: string;
  @ApiPropertyOptional() jobTitle?: string;
  @ApiPropertyOptional() netMonthlySalaryNaira?: number;
  @ApiPropertyOptional() salaryDay?: number;
  @ApiPropertyOptional() yearsEmployed?: string;
  @ApiPropertyOptional() bankName?: string;
  @ApiPropertyOptional() accountNumber?: string;
  @ApiPropertyOptional() requestedLimitNaira?: number;
}

export class UpdateKycDto extends RegisterDto {}

export const linkBankSchema = z.object({
  // The temporary authorisation code from the Mono Connect widget.
  code: z.string().min(1),
});
export type LinkBankInput = z.infer<typeof linkBankSchema>;
export class LinkBankDto implements LinkBankInput {
  @ApiProperty({ description: "Authorisation code from the Mono Connect widget" })
  code!: string;
}

// Mono Lookup BVN consent, in three legs (§9.1). The session id deliberately
// never crosses the wire — KycService holds it against the user id — so these
// bodies carry only what the applicant actually types.
export const bvnLookupStartSchema = z.object({
  bvn: z.string().regex(/^\d{11}$/, "BVN must be 11 digits"),
});
export type BvnLookupStartInput = z.infer<typeof bvnLookupStartSchema>;
export class BvnLookupStartDto implements BvnLookupStartInput {
  @ApiProperty({ description: "11-digit BVN to verify" }) bvn!: string;
}

export const bvnLookupOtpSchema = z.object({
  // One of the `method` values from the start call — passed back verbatim.
  method: z.string().min(1),
  // Required only for the "alternate_phone" method.
  phoneNumber: z.string().min(7).optional(),
});
export type BvnLookupOtpInput = z.infer<typeof bvnLookupOtpSchema>;
export class BvnLookupOtpDto implements BvnLookupOtpInput {
  @ApiProperty({ description: "A `method` from the start response" }) method!: string;
  @ApiPropertyOptional({ description: "Only for the alternate_phone method" }) phoneNumber?: string;
}

export const bvnLookupCompleteSchema = z.object({
  otp: z.string().regex(/^\d{4,8}$/, "Enter the code you were sent"),
});
export type BvnLookupCompleteInput = z.infer<typeof bvnLookupCompleteSchema>;
export class BvnLookupCompleteDto implements BvnLookupCompleteInput {
  @ApiProperty({ description: "The OTP NIBSS sent to the BVN holder" }) otp!: string;
}

export const uploadDocumentSchema = z.object({
  kind: z.enum(DOCUMENT_KINDS),
});
export class UploadDocumentDto {
  @ApiProperty({ enum: DOCUMENT_KINDS }) kind!: (typeof DOCUMENT_KINDS)[number];
  @ApiProperty({ type: "string", format: "binary" }) file!: unknown;
}

export const reviewDocumentSchema = z.object({
  status: z.enum(["accepted", "rejected"]),
  rejectionReason: z.string().min(1).optional(),
});
export type ReviewDocumentInput = z.infer<typeof reviewDocumentSchema>;
export class ReviewDocumentDto implements ReviewDocumentInput {
  @ApiProperty({ enum: ["accepted", "rejected"] }) status!: "accepted" | "rejected";
  @ApiPropertyOptional() rejectionReason?: string;
}

export const verifyKycSchema = z.object({
  decision: z.enum(["verified", "needs_more_info"]),
  note: z.string().min(1).optional(),
});
export type VerifyKycInput = z.infer<typeof verifyKycSchema>;
export class VerifyKycDto implements VerifyKycInput {
  @ApiProperty({ enum: ["verified", "needs_more_info"] }) decision!: "verified" | "needs_more_info";
  @ApiPropertyOptional({ description: "Required for needs_more_info — what the applicant must fix" })
  note?: string;
}
