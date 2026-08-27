import { Inject, Injectable } from "@nestjs/common";
import { desc, eq } from "drizzle-orm";
import { users, creditProfiles, type Db } from "@farmermarket/db";
import { DB } from "../../db/db.module";

@Injectable()
export class CustomersService {
  constructor(@Inject(DB) private readonly db: Db) {}

  // The 360° view (§11.4) is much bigger than this — profile, order
  // history, repayment behaviour, all applications, notes. This is just
  // "who has an account, and what's their credit limit right now."
  async findAll() {
    return this.db
      .select({
        id: users.id,
        phone: users.phone,
        fullName: users.fullName,
        email: users.email,
        createdAt: users.createdAt,
        creditLimitKobo: creditProfiles.creditLimitKobo,
        usedCreditKobo: creditProfiles.usedCreditKobo,
        tier: creditProfiles.tier,
        isVerified: creditProfiles.isVerified,
      })
      .from(users)
      .leftJoin(creditProfiles, eq(creditProfiles.userId, users.id))
      .orderBy(desc(users.createdAt));
  }
}
