import { ApiPropertyOptional } from "@nestjs/swagger";
import { z } from "zod";

export const verifyApplicationSchema = z.object({
  identityVerified: z.boolean().optional(),
  employerVerified: z.boolean().optional(),
  documentsVerified: z.boolean().optional(),
});

export type VerifyApplicationInput = z.infer<typeof verifyApplicationSchema>;

export class VerifyApplicationDto implements VerifyApplicationInput {
  @ApiPropertyOptional() identityVerified?: boolean;
  @ApiPropertyOptional() employerVerified?: boolean;
  @ApiPropertyOptional() documentsVerified?: boolean;
}
