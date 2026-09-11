import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { and, desc, eq, isNull } from "drizzle-orm";
import * as argon2 from "argon2";
import { phoneVerifications, type Db } from "@farmermarket/db";
import { DB } from "../../db/db.module";
import { normalisePhone } from "../../common/phone";
import { SMS_SENDER, type SmsSender } from "../integrations/sms/sms.types";
import type { OtpPurpose } from "./dto/otp.dto";

const CODE_TTL_MS = 10 * 60 * 1000; // code is valid 10 minutes
const RESEND_COOLDOWN_MS = 60 * 1000; // one code per minute per number
const MAX_ATTEMPTS = 5; // wrong guesses before the code is dead
const VERIFICATION_TOKEN_TTL = "20m"; // window to finish Sign Up after verifying

interface VerificationClaims {
  sub: string; // the normalised phone
  purpose: OtpPurpose;
  kind: "phone_verification";
}

@Injectable()
export class OtpService {
  private readonly log = new Logger("OtpService");

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(SMS_SENDER) private readonly sms: SmsSender,
    private readonly jwt: JwtService,
  ) {}

  /**
   * Generate a code, text it, and store only its hash. Returns how long the
   * code lasts and whether it was actually sent (false = dry-run, dev only).
   * Never returns the code.
   */
  async request(rawPhone: string, purpose: OtpPurpose) {
    const phone = normalisePhone(rawPhone);
    if (phone.length < 10) throw new BadRequestException("That phone number doesn't look right.");

    const [recent] = await this.db
      .select({ lastSentAt: phoneVerifications.lastSentAt })
      .from(phoneVerifications)
      .where(and(eq(phoneVerifications.phone, phone), eq(phoneVerifications.purpose, purpose)))
      .orderBy(desc(phoneVerifications.lastSentAt))
      .limit(1);

    if (recent && Date.now() - recent.lastSentAt.getTime() < RESEND_COOLDOWN_MS) {
      const wait = Math.ceil(
        (RESEND_COOLDOWN_MS - (Date.now() - recent.lastSentAt.getTime())) / 1000,
      );
      throw new HttpException(
        `Please wait ${wait}s before requesting another code.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const code = String(Math.floor(100000 + Math.random() * 900000));
    const codeHash = await argon2.hash(code, { type: argon2.argon2id });

    // Try to text it. A provider rejection (bad key, unapproved sender ID,
    // DND channel off) is logged loudly *with the code* so a stuck Sign Up
    // is still recoverable from the server log — but it doesn't hard-fail
    // the request. The client is told `sent: false` and shows a "we may be
    // having trouble texting it" note; the fake sender never throws.
    let delivered = this.sms.live;
    try {
      await this.sms.send(
        phone,
        `Your Demeterra verification code is ${code}. It expires in 10 minutes. Don't share it with anyone.`,
      );
    } catch (err) {
      delivered = false;
      this.log.error(
        `SMS send failed for ${phone} — code ${code} not delivered: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    // One live code per (phone, purpose): clear any unspent prior codes so a
    // stale one can't still be used. Spent rows are kept for the audit trail.
    await this.db
      .delete(phoneVerifications)
      .where(
        and(
          eq(phoneVerifications.phone, phone),
          eq(phoneVerifications.purpose, purpose),
          isNull(phoneVerifications.consumedAt),
        ),
      );

    await this.db.insert(phoneVerifications).values({
      phone,
      purpose,
      codeHash,
      expiresAt: new Date(Date.now() + CODE_TTL_MS),
      lastSentAt: new Date(),
    });

    return {
      sent: delivered,
      // Distinguishes "we deliberately didn't send" (dev/dry-run) from
      // "we tried and the provider refused" — the client wording differs.
      deliveryFailed: this.sms.live && !delivered,
      expiresInSeconds: CODE_TTL_MS / 1000,
    };
  }

  /**
   * Check a code. On success the row is spent and a short-lived signed token
   * is returned — the Sign Up call passes it back so the account can only be
   * created for a number that was actually proven.
   */
  async verify(rawPhone: string, code: string, purpose: OtpPurpose) {
    const phone = normalisePhone(rawPhone);

    const [row] = await this.db
      .select()
      .from(phoneVerifications)
      .where(
        and(
          eq(phoneVerifications.phone, phone),
          eq(phoneVerifications.purpose, purpose),
          isNull(phoneVerifications.consumedAt),
        ),
      )
      .orderBy(desc(phoneVerifications.createdAt))
      .limit(1);

    if (!row) {
      throw new BadRequestException("Request a code first, then enter it here.");
    }
    if (row.expiresAt.getTime() < Date.now()) {
      throw new BadRequestException("That code has expired — request a new one.");
    }
    if (row.attempts >= MAX_ATTEMPTS) {
      throw new BadRequestException("Too many wrong tries — request a new code.");
    }

    const ok = await argon2.verify(row.codeHash, code);
    if (!ok) {
      await this.db
        .update(phoneVerifications)
        .set({ attempts: row.attempts + 1 })
        .where(eq(phoneVerifications.id, row.id));
      const left = MAX_ATTEMPTS - (row.attempts + 1);
      throw new BadRequestException(
        left > 0 ? `Incorrect code. ${left} ${left === 1 ? "try" : "tries"} left.` : "Incorrect code — request a new one.",
      );
    }

    await this.db
      .update(phoneVerifications)
      .set({ consumedAt: new Date() })
      .where(eq(phoneVerifications.id, row.id));

    const claims: VerificationClaims = { sub: phone, purpose, kind: "phone_verification" };
    const verificationToken = this.jwt.sign(claims, { expiresIn: VERIFICATION_TOKEN_TTL });

    return { verified: true as const, verificationToken };
  }

  /**
   * Called by the Sign Up flow. Throws unless `token` is a valid, unexpired
   * proof that *this* number was verified for *this* purpose. Registration
   * has no bypass — in dev the FakeSmsSender logs the code so a real token
   * can still be obtained.
   */
  async assertPhoneVerified(token: string | undefined, rawPhone: string, purpose: OtpPurpose) {
    if (!token) {
      throw new BadRequestException("Verify your phone number before creating an account.");
    }
    let claims: VerificationClaims;
    try {
      claims = this.jwt.verify<VerificationClaims>(token);
    } catch {
      throw new BadRequestException(
        "Your phone verification has expired — verify the number again.",
      );
    }
    if (claims.kind !== "phone_verification" || claims.purpose !== purpose) {
      throw new BadRequestException("That verification can't be used here.");
    }
    if (claims.sub !== normalisePhone(rawPhone)) {
      throw new BadRequestException("The verified number doesn't match the one on the form.");
    }
  }
}
