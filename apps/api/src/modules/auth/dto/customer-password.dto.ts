import { ApiProperty } from "@nestjs/swagger";
import { z } from "zod";
import { passwordSchema } from "../../../common/password";

// Signed-in customer swapping their password. The current one must verify —
// a stolen 30-day token shouldn't be enough to lock the owner out.
export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, "Enter your current password."),
  newPassword: passwordSchema,
});
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
export class ChangePasswordDto implements ChangePasswordInput {
  @ApiProperty() currentPassword!: string;
  @ApiProperty({ description: "At least 8 characters, letters and numbers" }) newPassword!: string;
}

// Public recovery, and the way accounts created before passwords existed get
// one: prove control of the phone with an SMS code (purpose "reset"), then
// choose a password. Mirrors the register flow's phoneVerificationToken.
export const resetPasswordSchema = z.object({
  phone: z.string().min(6),
  phoneVerificationToken: z.string().min(1, "Verify your phone number first."),
  password: passwordSchema,
});
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
export class ResetPasswordDto implements ResetPasswordInput {
  @ApiProperty() phone!: string;
  @ApiProperty({ description: "Token from POST /auth/customer/otp/verify with purpose \"reset\"" })
  phoneVerificationToken!: string;
  @ApiProperty({ description: "At least 8 characters, letters and numbers" }) password!: string;
}
