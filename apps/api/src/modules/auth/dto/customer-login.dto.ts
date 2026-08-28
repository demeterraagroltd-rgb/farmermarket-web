import { ApiProperty } from "@nestjs/swagger";
import { z } from "zod";

// Phone + a user-chosen 6-digit login code (set at Sign Up, hashed on the
// `users` row). This endpoint only logs in an *existing* user — it never
// creates one, so a wrong number can't silently spin up a new account.
export const customerLoginSchema = z.object({
  phone: z.string().min(1),
  code: z.string().regex(/^\d{6}$/, "Login code must be 6 digits"),
});

export type CustomerLoginInput = z.infer<typeof customerLoginSchema>;

export class CustomerLoginDto implements CustomerLoginInput {
  @ApiProperty()
  phone!: string;

  @ApiProperty({ description: "6-digit login code chosen at Sign Up" })
  code!: string;
}
