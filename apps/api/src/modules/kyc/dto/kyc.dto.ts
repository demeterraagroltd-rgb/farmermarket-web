import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { z } from "zod";

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

const addressSchema = z.object({
  street: z.string().min(1),
  city: z.string().min(1),
  state: z.string().min(1),
  lga: z.string().min(1),
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
  nin: z.string().regex(/^\d{11}$/, "NIN must be 11 digits").optional(), // deferrable
  email: z.string().email().optional(),
  residentialAddress: addressSchema.optional(),
  stateOfOrigin: z.string().min(1).optional(),
  lgaOfOrigin: z.string().min(1).optional(),
  nextOfKin: nextOfKinSchema.optional(),
  employmentType: z.enum(["Government", "Private", "Self-employed"]).optional(),
  employer: z.string().optional(),
  jobTitle: z.string().optional(),
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
  loginCode: z.string().regex(/^\d{6}$/, "Login code must be 6 digits"),
});
export type RegisterInput = z.infer<typeof registerSchema>;

export class RegisterDto {
  @ApiProperty() fullName!: string;
  @ApiProperty() phone!: string;
  @ApiProperty() email!: string;
  @ApiProperty({ description: "6-digit login code" }) loginCode!: string;
  @ApiPropertyOptional() dateOfBirth?: string;
  @ApiPropertyOptional() gender?: string;
  @ApiPropertyOptional() maritalStatus?: string;
  @ApiPropertyOptional() dependantsCount?: number;
  @ApiPropertyOptional({ description: "11-digit BVN" }) bvn?: string;
  @ApiPropertyOptional({ description: "11-digit NIN (may be added later)" }) nin?: string;
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
