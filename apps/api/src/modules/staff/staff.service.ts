import { ConflictException, Inject, Injectable } from "@nestjs/common";
import { desc, eq } from "drizzle-orm";
import * as argon2 from "argon2";
import { authenticator } from "otplib";
import { staff, mfaCredentials, type Db } from "@farmermarket/db";
import { DB } from "../../db/db.module";
import type { CreateStaffInput } from "./dto/create-staff.dto";

@Injectable()
export class StaffService {
  constructor(@Inject(DB) private readonly db: Db) {}

  async findAll() {
    return this.db
      .select({
        id: staff.id,
        email: staff.email,
        fullName: staff.fullName,
        role: staff.role,
        isActive: staff.isActive,
        createdAt: staff.createdAt,
      })
      .from(staff)
      .orderBy(desc(staff.createdAt));
  }

  // Enrolment is pre-confirmed here rather than requiring the new staff
  // member to scan and verify a code first (§6.1's real design) — a
  // deliberate simplification so staff creation is usable today. The TOTP
  // secret is returned once, in this response only; there's nowhere else
  // to see it afterward, matching how a one-time API key is usually shown.
  async create(input: CreateStaffInput) {
    const [existing] = await this.db.select().from(staff).where(eq(staff.email, input.email)).limit(1);
    if (existing) throw new ConflictException("A staff account with this email already exists");

    const passwordHash = await argon2.hash(input.password, { type: argon2.argon2id });
    const secret = authenticator.generateSecret();

    return this.db.transaction(async (tx) => {
      const [account] = await tx
        .insert(staff)
        .values({ email: input.email, passwordHash, fullName: input.fullName, role: input.role })
        .returning();

      await tx.insert(mfaCredentials).values({
        staffId: account.id,
        secret,
        confirmedAt: new Date(),
      });

      return {
        id: account.id,
        email: account.email,
        fullName: account.fullName,
        role: account.role,
        totpSecret: secret,
        otpauthUrl: authenticator.keyuri(account.email, "Farmer Market", secret),
      };
    });
  }
}
