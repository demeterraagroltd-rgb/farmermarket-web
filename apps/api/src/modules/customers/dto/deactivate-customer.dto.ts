import { ApiPropertyOptional } from "@nestjs/swagger";
import { z } from "zod";

// Optional free-text reason, kept on the audit-log row (never shown to the
// customer). `.default({})` so a bodyless DELETE (Nest passes `undefined`
// or `{}`) is still valid.
export const deactivateCustomerSchema = z
  .object({
    reason: z.string().trim().min(1).max(500).optional(),
  })
  .default({});

export type DeactivateCustomerInput = z.infer<typeof deactivateCustomerSchema>;

export class DeactivateCustomerDto implements DeactivateCustomerInput {
  @ApiPropertyOptional({
    description: "Why the account is being removed. Stored on the audit log only.",
  })
  reason?: string;
}
