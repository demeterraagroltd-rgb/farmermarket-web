import { ApiProperty } from "@nestjs/swagger";
import { z } from "zod";

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  totpCode: z.string().length(6).regex(/^\d+$/),
});

export type LoginInput = z.infer<typeof loginSchema>;

export class LoginDto implements LoginInput {
  @ApiProperty()
  email!: string;

  @ApiProperty()
  password!: string;

  @ApiProperty({ description: "6-digit TOTP code" })
  totpCode!: string;
}
