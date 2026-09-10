import {
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from "@nestjs/common";
import { timingSafeEqual } from "node:crypto";

/**
 * Auth for machine-triggered endpoints (the daily collections run). A shared
 * secret in the `x-cron-secret` header, compared in constant time. Kept
 * separate from staff JWT auth — a scheduler has no staff account, and this
 * never touches the `staff` table.
 *
 * With no `COLLECTIONS_CRON_SECRET` set, the endpoint is closed rather than
 * open — 503, not 200.
 */
@Injectable()
export class CronSecretGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const expected = process.env.COLLECTIONS_CRON_SECRET;
    if (!expected) {
      throw new ServiceUnavailableException("This endpoint is not configured.");
    }
    const req = context.switchToHttp().getRequest();
    const got = req.headers?.["x-cron-secret"];
    if (
      typeof got !== "string" ||
      got.length !== expected.length ||
      !timingSafeEqual(Buffer.from(got), Buffer.from(expected))
    ) {
      throw new UnauthorizedException("Bad or missing cron secret.");
    }
    return true;
  }
}
