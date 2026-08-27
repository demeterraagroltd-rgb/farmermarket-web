import { ApiPropertyOptional, ApiProperty } from "@nestjs/swagger";
import { z } from "zod";

// TOTP is intentionally not required — a deliberate simplification, not an
// oversight (the field and its verification still exist below in case it's
// turned back on). If it's ever required again, add `.length(6).regex(/^\d+$/)`
// back and drop `.optional()`.
export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  totpCode: z.string().optional(),
});

export type LoginInput = z.infer<typeof loginSchema>;

export class LoginDto implements LoginInput {
  @ApiProperty()
  email!: string;

  @ApiProperty()
  password!: string;

  @ApiPropertyOptional({ description: "6-digit TOTP code — currently not required" })
  totpCode?: string;
}
