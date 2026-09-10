// Nigerian MSISDN normalisation. The apps accept "0803...", "+234 803...",
// "234803..." etc.; the SMS provider and our stored `phone_verifications`
// rows need one canonical form. We normalise to `234XXXXXXXXXX` (no plus).
//
// Deliberately conservative: anything that doesn't look like a Nigerian
// mobile number is returned digits-only and left for the caller's own
// length/shape validation, rather than mangled into something wrong.
export function normalisePhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.startsWith("234") && digits.length === 13) return digits;
  if (digits.startsWith("0") && digits.length === 11) return `234${digits.slice(1)}`;
  if (digits.length === 10) return `234${digits}`; // bare "80..." without the 0
  return digits;
}

/** True for a well-formed Nigerian mobile number in canonical form. */
export function isNigerianMobile(normalised: string): boolean {
  return /^234[789]\d{9}$/.test(normalised);
}
