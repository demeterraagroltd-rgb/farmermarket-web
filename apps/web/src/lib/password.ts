// Client-side mirror of the API's password policy
// (apps/api/src/common/password.ts) so the wizard can stop an obviously
// wrong password before a round-trip. The server is still the authority —
// this only shapes the message the applicant sees first.
export const PASSWORD_MIN_LENGTH = 8;

export const PASSWORD_HELP =
  "At least 8 characters, using both letters and numbers — like FM2026Ab92.";

/** A human reason the password won't do, or null when it passes. */
export function passwordProblem(value: string): string | null {
  if (value.length < PASSWORD_MIN_LENGTH) {
    return `Your password must be at least ${PASSWORD_MIN_LENGTH} characters.`;
  }
  if (!/[A-Za-z]/.test(value)) return "Your password must contain at least one letter.";
  if (!/\d/.test(value)) return "Your password must contain at least one number.";
  return null;
}
