import { BadRequestException, Logger } from "@nestjs/common";
import type { BvnSession, IdentityRecord, LookupClient } from "./lookup.types";

/** The only OTP the fake accepts, so the consent leg is walkable offline. */
export const FAKE_LOOKUP_OTP = "123456";

/**
 * Used when `MONO_LOOKUP_SECRET_KEY` isn't set. Returns a stable record for
 * ADA OKONKWO — the same person FakeMonoClient banks as — so the two fakes
 * corroborate each other and the reviewer screen shows a full match.
 *
 * The consent leg is real enough to test the UI: initiate hands back two
 * methods, and fetchBvn rejects anything but FAKE_LOOKUP_OTP, so the
 * wrong-code path is exercisable too. Same "no key ⇒ fake" pattern as
 * SMS/email/Connect.
 */
export class FakeLookupClient implements LookupClient {
  readonly live = false;
  private readonly log = new Logger("FakeLookupClient");
  private readonly sessions = new Set<string>();

  async initiateBvn(bvn: string): Promise<BvnSession> {
    if (!/^\d{11}$/.test(bvn)) throw new BadRequestException("Mono Lookup: BVN must be 11 digits");
    const sessionId = `sess_fake_${Date.now().toString(36)}`;
    this.sessions.add(sessionId);
    this.log.log(`[lookup:fake] initiateBvn(•••${bvn.slice(-4)}) → ${sessionId}`);
    return {
      sessionId,
      // Mirrors the real mix NIBSS can offer: an email on file (common, and
      // the only route while no SMS provider is live on our side — NIBSS
      // sends these codes itself, not Termii), a phone on file, and a
      // holder-nominated number.
      methods: [
        { method: "phone", hint: "OTP will be sent to 080•••••12" },
        { method: "email", hint: "OTP will be sent to ad•••@gmail.com" },
        { method: "alternate_phone", hint: "Send to a number you nominate" },
      ],
    };
  }

  async sendBvnOtp(sessionId: string, method: string): Promise<void> {
    if (!this.sessions.has(sessionId)) {
      throw new BadRequestException("Mono Lookup: invalid or expired session");
    }
    this.log.log(`[lookup:fake] sendBvnOtp(${method}) → use ${FAKE_LOOKUP_OTP}`);
  }

  async fetchBvn(sessionId: string, otp: string): Promise<IdentityRecord> {
    if (!this.sessions.has(sessionId)) {
      throw new BadRequestException("Mono Lookup: invalid or expired session");
    }
    if (otp !== FAKE_LOOKUP_OTP) throw new BadRequestException("Mono Lookup: incorrect OTP");
    this.sessions.delete(sessionId);
    return this.record("bvn");
  }

  async lookupNin(nin: string): Promise<IdentityRecord> {
    if (!/^\d{11}$/.test(nin)) throw new BadRequestException("Mono Lookup: NIN must be 11 digits");
    this.log.log(`[lookup:fake] lookupNin(•••${nin.slice(-4)})`);
    return this.record("nin");
  }

  private record(source: "bvn" | "nin"): IdentityRecord {
    return {
      source,
      firstName: "ADA",
      lastName: "OKONKWO",
      middleName: "NGOZI",
      dateOfBirth: "1992-04-28",
      gender: "Female",
      phone: "08031234512",
      nin: "22222222222",
    };
  }
}
