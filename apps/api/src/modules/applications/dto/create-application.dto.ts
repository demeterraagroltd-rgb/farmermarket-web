import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { z } from "zod";

// Deliberately narrower than the plan's full wizard (§11.3): no BVN, no bank
// linking, no documents — those need Mono/Termii/S3, which aren't wired up
// yet. This is the "fake adapters first" slice (§9.2), covering only what a
// public applicant can submit without any third-party dependency.
export const createApplicationSchema = z.object({
  fullName: z.string().min(1),
  phone: z.string().min(1),
  email: z.string().email().optional(),
  employer: z.string().optional(),
  employmentType: z.enum(["Government", "Private"]).optional(),
  jobTitle: z.string().optional(),
  netMonthlySalaryNaira: z.number().positive().optional(),
  requestedLimitNaira: z.number().positive(),
  salaryDay: z.number().int().min(1).max(31).optional(),
});

export type CreateApplicationInput = z.infer<typeof createApplicationSchema>;

export class CreateApplicationDto implements CreateApplicationInput {
  @ApiProperty()
  fullName!: string;

  @ApiProperty()
  phone!: string;

  @ApiPropertyOptional()
  email?: string;

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
}
