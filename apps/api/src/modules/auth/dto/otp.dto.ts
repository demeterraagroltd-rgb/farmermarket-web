import { ApiProperty } from "@nestjs/swagger";
import { z } from "zod";

// 'register' is the only purpose wired up today (Sign Up). The field exists
// now so login-OTP / code-reset can be added without a schema change.
export const otpPurposeSchema = z.enum(["register"]);
export type OtpPurpose = z.infer<typeof otpPurposeSchema>;

export const otpRequestSchema = z.object({
  phone: z.string().min(6),
  purpose: otpPurposeSchema.default("register"),
});
export type OtpRequestInput = z.infer<typeof otpRequestSchema>;

export const otpVerifySchema = z.object({
  phone: z.string().min(6),
  code: z.string().regex(/^\d{6}$/, "The code is 6 digits"),
  purpose: otpPurposeSchema.default("register"),
});
export type OtpVerifyInput = z.infer<typeof otpVerifySchema>;

export class OtpRequestDto implements OtpRequestInput {
  @ApiProperty()
  phone!: string;

  @ApiProperty({ enum: ["register"], default: "register" })
  purpose!: OtpPurpose;
}

export class OtpVerifyDto implements OtpVerifyInput {
  @ApiProperty()
  phone!: string;

  @ApiProperty({ description: "6-digit code from the SMS" })
  code!: string;

  @ApiProperty({ enum: ["register"], default: "register" })
  purpose!: OtpPurpose;
}
