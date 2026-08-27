import "reflect-metadata";
import { describe, expect, it, vi } from "vitest";
import { UnauthorizedException, type ExecutionContext } from "@nestjs/common";
import { CustomerJwtAuthGuard } from "./customer-jwt-auth.guard";

function makeContext(headers: Record<string, string>) {
  const request: Record<string, unknown> = { headers };
  const context = {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
  return { context, request };
}

function makeDb(row: { id: string } | undefined) {
  return {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve(row ? [row] : []),
        }),
      }),
    }),
  } as any;
}

describe("CustomerJwtAuthGuard", () => {
  it("rejects a staff token — kind must be exactly 'customer'", async () => {
    const jwt = { verify: vi.fn(() => ({ sub: "s1", role: "admin" })) } as any; // no `kind` claim, like a staff token
    const guard = new CustomerJwtAuthGuard(jwt, makeDb(undefined));
    const { context } = makeContext({ authorization: "Bearer good" });
    await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
  });

  it("rejects a customer token for a user that no longer exists", async () => {
    const jwt = { verify: vi.fn(() => ({ sub: "u1", kind: "customer" })) } as any;
    const guard = new CustomerJwtAuthGuard(jwt, makeDb(undefined));
    const { context } = makeContext({ authorization: "Bearer good" });
    await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
  });

  it("attaches userId to the request and allows the call for a valid customer token", async () => {
    const jwt = { verify: vi.fn(() => ({ sub: "u1", kind: "customer" })) } as any;
    const guard = new CustomerJwtAuthGuard(jwt, makeDb({ id: "u1" }));
    const { context, request } = makeContext({ authorization: "Bearer good" });
    const result = await guard.canActivate(context);
    expect(result).toBe(true);
    expect(request.user).toEqual({ userId: "u1" });
  });
});
