import "reflect-metadata";
import { describe, expect, it, vi } from "vitest";
import { UnauthorizedException, type ExecutionContext } from "@nestjs/common";
import { JwtAuthGuard } from "./jwt-auth.guard";

function makeContext(headers: Record<string, string>) {
  const request: Record<string, unknown> = { headers };
  const context = {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
  return { context, request };
}

function makeDb(row: { id: string; role: string; isActive: boolean } | undefined) {
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

describe("JwtAuthGuard", () => {
  it("rejects a request with no bearer token", async () => {
    const jwt = { verify: vi.fn() } as any;
    const guard = new JwtAuthGuard(jwt, makeDb(undefined));
    const { context } = makeContext({});
    await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
  });

  it("rejects a token that fails verification", async () => {
    const jwt = { verify: vi.fn(() => { throw new Error("bad token"); }) } as any;
    const guard = new JwtAuthGuard(jwt, makeDb(undefined));
    const { context } = makeContext({ authorization: "Bearer bad" });
    await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
  });

  it("rejects a valid token for a deactivated staff account (§6.1 — a deactivated account cannot ride an unexpired token)", async () => {
    const jwt = { verify: vi.fn(() => ({ sub: "s1", role: "admin" })) } as any;
    const guard = new JwtAuthGuard(jwt, makeDb({ id: "s1", role: "admin", isActive: false }));
    const { context } = makeContext({ authorization: "Bearer good" });
    await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
  });

  it("rejects a valid token for a staff row that no longer exists", async () => {
    const jwt = { verify: vi.fn(() => ({ sub: "gone", role: "admin" })) } as any;
    const guard = new JwtAuthGuard(jwt, makeDb(undefined));
    const { context } = makeContext({ authorization: "Bearer good" });
    await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
  });

  it("attaches the re-verified staff (from the DB, not just the JWT claim) to the request and allows the call", async () => {
    const jwt = { verify: vi.fn(() => ({ sub: "s1", role: "admin" })) } as any;
    const guard = new JwtAuthGuard(jwt, makeDb({ id: "s1", role: "credit", isActive: true }));
    const { context, request } = makeContext({ authorization: "Bearer good" });
    const result = await guard.canActivate(context);
    expect(result).toBe(true);
    // Role comes from the DB row, not the (possibly stale) JWT claim.
    expect(request.staff).toEqual({ staffId: "s1", role: "credit" });
  });
});
