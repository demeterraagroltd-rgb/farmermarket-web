import { z } from "zod";

// The credential a customer signs in with — a real password, replacing the
// 6-digit login code. A code that short is brute-forceable against its hash;
// a password that must mix letters and digits is not. The example in the
// product spec is `FM2026Ab92`.
export const PASSWORD_MIN_LENGTH = 8;

export const PASSWORD_HELP =
  "At least 8 characters, using both letters and numbers — like FM2026Ab92.";

export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`)
  .max(128, "Password must be at most 128 characters.")
  .regex(/[A-Za-z]/, "Password must contain at least one letter.")
  .regex(/\d/, "Password must contain at least one number.");
