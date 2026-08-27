import { Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { eq } from "drizzle-orm";
import * as argon2 from "argon2";
import { authenticator } from "otplib";
import { staff, mfaCredentials, sessions, type Db } from "@farmermarket/db";
import { DB } from "../../db/db.module";
import type { LoginInput } from "./dto/login.dto";

const ACCESS_TOKEN_TTL = "15m"; // §6.1

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

    const [mfa] = await this.db
      .select()
      .from(mfaCredentials)
      .where(eq(mfaCredentials.staffId, account.id))
      .limit(1);

    if (!mfa?.confirmedAt) {
      throw new UnauthorizedException("MFA is not enrolled for this account");
    }

    const totpOk = authenticator.check(input.totpCode, mfa.secret);
    if (!totpOk) {
      throw new UnauthorizedException("Invalid TOTP code");
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
}
