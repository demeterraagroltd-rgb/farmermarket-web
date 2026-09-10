import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ServiceUnavailableException, UnauthorizedException, type ExecutionContext } from "@nestjs/common";
import { CronSecretGuard } from "./cron-secret.guard";

function ctx(headers: Record<string, unknown>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ headers }) }),
  } as unknown as ExecutionContext;
}

describe("CronSecretGuard", () => {
  const guard = new CronSecretGuard();
  const original = process.env.COLLECTIONS_CRON_SECRET;

  beforeEach(() => {
    process.env.COLLECTIONS_CRON_SECRET = "s3cr3t-value-1234567890";
  });
  afterEach(() => {
    if (original === undefined) delete process.env.COLLECTIONS_CRON_SECRET;
    else process.env.COLLECTIONS_CRON_SECRET = original;
  });

  it("allows a request with the exact secret", () => {
    expect(guard.canActivate(ctx({ "x-cron-secret": "s3cr3t-value-1234567890" }))).toBe(true);
  });

  it("rejects a wrong secret", () => {
    expect(() => guard.canActivate(ctx({ "x-cron-secret": "wrong" }))).toThrow(UnauthorizedException);
  });

  it("rejects a missing header", () => {
    expect(() => guard.canActivate(ctx({}))).toThrow(UnauthorizedException);
  });

  it("is closed, not open, when no secret is configured", () => {
    delete process.env.COLLECTIONS_CRON_SECRET;
    expect(() => guard.canActivate(ctx({ "x-cron-secret": "anything" }))).toThrow(
      ServiceUnavailableException,
    );
  });
});
