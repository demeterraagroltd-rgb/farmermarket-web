import { Inject, Injectable, NotFoundException, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { eq } from "drizzle-orm";
import * as argon2 from "argon2";
import { authenticator } from "otplib";
import { staff, mfaCredentials, sessions, users, type Db } from "@farmermarket/db";
import { DB } from "../../db/db.module";
import type { LoginInput } from "./dto/login.dto";
import type { CustomerLoginInput } from "./dto/customer-login.dto";

const ACCESS_TOKEN_TTL = "15m"; // §6.1
// No refresh-token/session mechanism on the customer side yet — the
// Flutter AuthTokenStore only holds a single token today (§14, no OTP
// session design exists). A long-lived token is the honest stand-in;
// replace with real rotating sessions once Termii OTP lands.
const CUSTOMER_ACCESS_TOKEN_TTL = "30d";

@Injectable()
export class AuthService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly jwt: JwtService,
  ) {}

  /** argon2id, per §6.1 — never bcrypt/scrypt for new credentials here. */
  async hashPassword(password: string): Promise<string> {
    return argon2.hash(password, { type: argon2.argon2id });
  }

  async loginStaff(input: LoginInput) {
    const [account] = await this.db
      .select()
      .from(staff)
      .where(eq(staff.email, input.email))
      .limit(1);

    if (!account || !account.isActive) {
      throw new UnauthorizedException("Invalid credentials");
    }

    const passwordOk = await argon2.verify(account.passwordHash, input.password);
    if (!passwordOk) {
      throw new UnauthorizedException("Invalid credentials");
    }

    // MFA is intentionally not enforced right now (product decision, not an
    // oversight) — but if a code was actually sent and the account has MFA
    // enrolled, still check it, so entering a wrong code doesn't silently
    // succeed. Omitting the field entirely is what skips MFA.
    if (input.totpCode) {
      const [mfa] = await this.db
        .select()
        .from(mfaCredentials)
        .where(eq(mfaCredentials.staffId, account.id))
        .limit(1);

      if (mfa?.confirmedAt && !authenticator.check(input.totpCode, mfa.secret)) {
        throw new UnauthorizedException("Invalid TOTP code");
      }
    }

    const accessToken = this.jwt.sign(
      { sub: account.id, role: account.role },
      { expiresIn: ACCESS_TOKEN_TTL },
    );

    // Rotating refresh token: only its hash is stored, so a leaked DB row
    // is not a usable credential (§6.1).
    const refreshToken = crypto.randomUUID() + crypto.randomUUID();
    const refreshTokenHash = await argon2.hash(refreshToken);

    await this.db.insert(sessions).values({
      staffId: account.id,
      refreshTokenHash,
      expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30), // 30 days
    });

    return { accessToken, refreshToken, role: account.role };
  }

  /**
   * Phone-only login for an *existing* customer — see customer-login.dto.ts
   * for why this doesn't create an account. `kind: 'customer'` in the JWT
   * claim is a defense-in-depth marker: CustomerJwtAuthGuard checks it
   * explicitly rather than relying only on "this id isn't in `staff`" to
   * keep a customer token out of staff-only routes.
   */
  async loginCustomer(input: CustomerLoginInput) {
    const [user] = await this.db.select().from(users).where(eq(users.phone, input.phone)).limit(1);
    if (!user) {
      throw new NotFoundException(
        "No account found for this phone number — submit an application first",
      );
    }

    const accessToken = this.jwt.sign(
      { sub: user.id, kind: "customer" },
      { expiresIn: CUSTOMER_ACCESS_TOKEN_TTL },
    );

    return { accessToken, userId: user.id, fullName: user.fullName };
  }
}
