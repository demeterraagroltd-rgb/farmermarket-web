import { Inject, Injectable, type CanActivate, type ExecutionContext, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { eq } from "drizzle-orm";
import { users } from "@farmermarket/db";
import { DB } from "../../db/db.module";
import type { Db } from "@farmermarket/db";

/**
 * Customer-side counterpart to JwtAuthGuard. Checks the `kind: "customer"`
 * claim explicitly (not just "this id isn't in `staff`") so a customer
 * token can never be accepted on a staff-only route by coincidence, and
 * vice versa.
 */
@Injectable()
export class CustomerJwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    @Inject(DB) private readonly db: Db,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const header: string | undefined = request.headers?.authorization;
    if (!header?.startsWith("Bearer ")) {
      throw new UnauthorizedException("Missing bearer token");
    }

    const token = header.slice("Bearer ".length);
    let payload: { sub: string; kind?: string };
    try {
      payload = this.jwt.verify(token);
    } catch {
      throw new UnauthorizedException("Invalid or expired token");
    }

    if (payload.kind !== "customer") {
      throw new UnauthorizedException("Not a customer token");
    }

    const [row] = await this.db
      .select({ id: users.id, deactivatedAt: users.deactivatedAt })
      .from(users)
      .where(eq(users.id, payload.sub))
      .limit(1);
    if (!row) {
      throw new UnauthorizedException("Account no longer exists");
    }
    // Mirrors JwtAuthGuard's staff check — a deactivated customer can't ride
    // an unexpired token.
    if (row.deactivatedAt) {
      throw new UnauthorizedException("Account is deactivated");
    }

    request.user = { userId: row.id };
    return true;
  }
}
