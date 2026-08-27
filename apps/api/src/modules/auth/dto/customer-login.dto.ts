import { ApiProperty } from "@nestjs/swagger";
import { z } from "zod";

// Phone-only, no OTP — the honest stand-in until Termii lands (§9.3, §14).
// Mirrors the identity step ApplicationsService.create() already uses:
// a phone number is the entire identity claim right now. This endpoint
// only logs in an *existing* user (created by submitting an application);
// it deliberately does not create one, so a wrong number can't silently
// spin up a new account.
export const customerLoginSchema = z.object({
  phone: z.string().min(1),
});

export type CustomerLoginInput = z.infer<typeof customerLoginSchema>;

export class CustomerLoginDto implements CustomerLoginInput {
  @ApiProperty()
  phone!: string;
}
