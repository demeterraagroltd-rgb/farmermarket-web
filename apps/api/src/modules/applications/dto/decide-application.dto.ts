import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { z } from "zod";

// Mirrors the DB's decline_needs_reason check constraint (§5.2) at the
// application layer too, so a bad request gets a clear 400 instead of a
// raw constraint-violation error.
export const decideApplicationSchema = z
  .object({
    outcome: z.enum(["approved", "declined", "referred"]),
    approvedLimitNaira: z.number().positive().optional(),
    reasonCodes: z.array(z.string()).optional(),
    notes: z.string().optional(),
  })
  .refine((data) => data.outcome !== "declined" || (data.reasonCodes?.length ?? 0) > 0, {
    message: "reasonCodes is required when declining",
    path: ["reasonCodes"],
  })
  .refine((data) => data.outcome !== "approved" || data.approvedLimitNaira !== undefined, {
    message: "approvedLimitNaira is required when approving",
    path: ["approvedLimitNaira"],
  });

export type DecideApplicationInput = z.infer<typeof decideApplicationSchema>;

export class DecideApplicationDto {
  @ApiProperty({ enum: ["approved", "declined", "referred"] })
  outcome!: "approved" | "declined" | "referred";

  @ApiPropertyOptional()
  approvedLimitNaira?: number;

  @ApiPropertyOptional({ type: [String] })
  reasonCodes?: string[];

  @ApiPropertyOptional()
  notes?: string;
}
