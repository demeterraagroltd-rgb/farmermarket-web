import { ApiProperty } from "@nestjs/swagger";
import { z } from "zod";

// Phone + the password chosen at Sign Up (hashed on the `users` row). This
// endpoint only logs in an *existing* user — it never creates one, so a wrong
// number can't silently spin up a new account.
//
// No password policy here on purpose: a login attempt is checked against a
// hash, so rejecting "too short" inputs before that check would only tell an
// attacker which numbers have accounts. The policy lives on the write paths
// (register / change / reset).
//
// `code` is the pre-password name for this field, still sent by every phone
// app build that hasn't been updated yet. Old 6-digit codes are stored as the
// same kind of hash and verify identically, so accepting the old name keeps
// those installs signed in instead of locking them out the moment this
// deploys. Remove it once the mobile app has shipped the rename.
export const customerLoginSchema = z.preprocess(
  (raw) => {
    if (raw && typeof raw === "object" && !("password" in raw) && "code" in raw) {
      const { code, ...rest } = raw as Record<string, unknown>;
      return { ...rest, password: code };
    }
    return raw;
  },
  z.object({
    phone: z.string().min(1),
    password: z.string().min(1, "Password is required."),
  }),
);

export type CustomerLoginInput = z.infer<typeof customerLoginSchema>;

export class CustomerLoginDto implements CustomerLoginInput {
  @ApiProperty()
  phone!: string;

  @ApiProperty({ description: "Password chosen at Sign Up" })
  password!: string;
}
