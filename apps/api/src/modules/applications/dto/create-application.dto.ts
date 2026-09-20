import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { z } from "zod";
import { passwordSchema } from "../../../common/password";

// Deliberately narrower than the plan's full wizard (§11.3): no BVN, no bank
// linking, no documents — those need Mono/Termii/S3, which aren't wired up
// yet. This is the "fake adapters first" slice (§9.2), covering only what a
// public applicant can submit without any third-party dependency.
// The mobile Sign Up posts here. `email` and `password` are optional at the
// schema level so a partial submission keeps working; when `password` is
// present it's hashed onto the user row (that's how they'll sign in). The
// full-KYC wizard (Phase 3) always sends both.
export const createApplicationSchema = z.object({
  fullName: z.string().min(1),
  phone: z.string().min(1),
  email: z.string().email().optional(),
  // The password the user chooses at Sign Up — how they'll sign in afterwards.
  password: passwordSchema.optional(),
  employer: z.string().optional(),
  employmentType: z.enum(["Government", "Private"]).optional(),
  jobTitle: z.string().optional(),
  netMonthlySalaryNaira: z.number().positive().optional(),
  requestedLimitNaira: z.number().positive(),
  salaryDay: z.number().int().min(1).max(31).optional(),
  // Proof the phone was SMS-verified. Optional while no SMS sender is
  // approved; enforced when PHONE_VERIFICATION_REQUIRED=true.
  phoneVerificationToken: z.string().min(1).optional(),
});

export type CreateApplicationInput = z.infer<typeof createApplicationSchema>;

export class CreateApplicationDto implements CreateApplicationInput {
  @ApiProperty()
  fullName!: string;

  @ApiProperty()
  phone!: string;

  @ApiPropertyOptional()
  email?: string;

  @ApiPropertyOptional({ description: "Password the user chooses at Sign Up" })
  password?: string;

  @ApiPropertyOptional()
  employer?: string;

  @ApiPropertyOptional({ enum: ["Government", "Private"] })
  employmentType?: "Government" | "Private";

  @ApiPropertyOptional()
  jobTitle?: string;

  @ApiPropertyOptional()
  netMonthlySalaryNaira?: number;

  @ApiProperty()
  requestedLimitNaira!: number;

  @ApiPropertyOptional()
  salaryDay?: number;

  @ApiPropertyOptional({ description: "Token from POST /auth/customer/otp/verify" })
  phoneVerificationToken?: string;
}
