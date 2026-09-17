// Mono Lookup — government-record identity verification for KYC (§9.1).
// Behind an interface with a fake, like every other integration. Same host
// and same `mono-sec-key` header as Connect, but a *different* product and
// usually a different app in the Mono dashboard, hence its own key
// (MONO_LOOKUP_SECRET_KEY). Never exposed to a client.
//
// BVN is a three-legged consent flow, not a single call: the BVN holder has
// to approve the disclosure with an OTP sent to a contact NIBSS already has
// on file. NIN is a single call with no consent step.
//
//   initiateBvn(bvn)  → session + the contact methods NIBSS will send to
//   sendBvnOtp(...)   → dispatches the code to the chosen method
//   fetchBvn(...)     → exchanges the code for the record
//
// The session is server-side only (see KycService): handing it to a browser
// would let a caller finish someone else's consent from another session.

export const LOOKUP_CLIENT = Symbol("LOOKUP_CLIENT");

/** One way NIBSS can reach the BVN holder. `hint` is pre-masked by Mono. */
export interface BvnOtpMethod {
  /** "phone" | "phone_1" | "alternate_phone" | "email" — passed back verbatim. */
  method: string;
  /** e.g. "OTP will be sent to 080******12" — safe to show the applicant. */
  hint: string | null;
}

export interface BvnSession {
  sessionId: string;
  methods: BvnOtpMethod[];
}

/** The subset of a government record we're willing to hold, normalised. */
export interface IdentityRecord {
  source: "bvn" | "nin";
  firstName: string | null;
  lastName: string | null;
  middleName: string | null;
  /** ISO YYYY-MM-DD when parseable, else the raw string, else null. */
  dateOfBirth: string | null;
  gender: string | null;
  phone: string | null;
  /** NIN as reported by a BVN lookup — lets one check corroborate the other. */
  nin: string | null;
}

export interface LookupClient {
  /** True for the real client — the fake reports false so callers can note it. */
  readonly live: boolean;

  /** Stage 1: start a BVN consent request. Sessions expire in ~10 minutes. */
  initiateBvn(bvn: string): Promise<BvnSession>;

  /**
   * Stage 2: ask NIBSS to send the code. `phoneNumber` is required only for
   * the "alternate_phone" method, where the holder nominates the number.
   */
  sendBvnOtp(sessionId: string, method: string, phoneNumber?: string): Promise<void>;

  /** Stage 3: exchange the OTP for the record. */
  fetchBvn(sessionId: string, otp: string): Promise<IdentityRecord>;

  /** Single-call NIN lookup — no consent leg. */
  lookupNin(nin: string): Promise<IdentityRecord>;
}
