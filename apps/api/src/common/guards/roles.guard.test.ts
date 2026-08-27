import "reflect-metadata";
import { describe, expect, it } from "vitest";
import { ForbiddenException, type ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { RolesGuard } from "./roles.guard";
import type { StaffRole } from "../decorators/roles.decorator";

// Authz testing gate (§13): every role/route combination the guard can see
// must be exercised, not just the happy path.
function makeContext(role: StaffRole | undefined): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ staff: role ? { staffId: "s1", role } : undefined }) }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as unknown as ExecutionContext;
}

describe("RolesGuard", () => {
  it("allows a route with no @Roles() decorator through (nothing to check)", () => {
    const reflector = { getAllAndOverride: () => undefined } as unknown as Reflector;
    const guard = new RolesGuard(reflector);
    expect(guard.canActivate(makeContext("sales"))).toBe(true);
  });

  it("allows a matching role", () => {
    const reflector = { getAllAndOverride: () => ["admin", "super_admin"] } as unknown as Reflector;
    const guard = new RolesGuard(reflector);
    expect(guard.canActivate(makeContext("admin"))).toBe(true);
  });

  it("rejects a non-matching role", () => {
    const reflector = { getAllAndOverride: () => ["super_admin"] } as unknown as Reflector;
    const guard = new RolesGuard(reflector);
    expect(() => guard.canActivate(makeContext("sales"))).toThrow(ForbiddenException);
  });

  it("rejects when no staff is attached to the request", () => {
    const reflector = { getAllAndOverride: () => ["admin"] } as unknown as Reflector;
    const guard = new RolesGuard(reflector);
    expect(() => guard.canActivate(makeContext(undefined))).toThrow(ForbiddenException);
  });

  it.each<StaffRole>(["super_admin", "admin", "credit", "sales"])(
    "role %s cannot access a route scoped to super_admin only",
    (role) => {
      const reflector = { getAllAndOverride: () => ["super_admin"] } as unknown as Reflector;
      const guard = new RolesGuard(reflector);
      if (role === "super_admin") {
        expect(guard.canActivate(makeContext(role))).toBe(true);
      } else {
        expect(() => guard.canActivate(makeContext(role))).toThrow(ForbiddenException);
      }
    },
  );
});
