import { Inject, Injectable, type CanActivate, type ExecutionContext, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { eq } from "drizzle-orm";
import { staff } from "@farmermarket/db";
import { DB } from "../../db/db.module";
import type { Db } from "@farmermarket/db";

/**
 * Verifies the bearer JWT, then re-checks the role against `staff` on every
 * request (§6.1) — a deactivated account can't ride an unexpired token.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
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
    let payload: { sub: string; role: string };
    try {
      payload = this.jwt.verify(token);
    } catch {
      throw new UnauthorizedException("Invalid or expired token");
    }

    const [row] = await this.db
      .select({ id: staff.id, role: staff.role, isActive: staff.isActive })
      .from(staff)
      .where(eq(staff.id, payload.sub))
      .limit(1);

    if (!row || !row.isActive) {
      throw new UnauthorizedException("Account is deactivated or no longer exists");
    }

    request.staff = { staffId: row.id, role: row.role };
    return true;
  }
}
