import { beforeAll, describe, expect, it } from "vitest";
import { BadRequestException, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import * as argon2 from "argon2";
import { applicantProfiles, users } from "@farmermarket/db";
import { AuthService } from "./auth.service";
import type { OtpService } from "./otp.service";

// AuthService touches `users` (and `applicant_profiles` for the login
// response's verification status) through two shapes: select→where→limit and
// update→set→where. One row per test is enough, so `where` is a no-op and
// `limit(1)` reads the head of the list — exactly what the real clause would
// have selected.
class FakeDb {
  users: any[] = [];
  profiles: any[] = [];

  private rows(table: unknown) {
    return table === users ? this.users : this.profiles;
  }

  select(projection?: Record<string, unknown>) {
    return {
      from: (table: unknown) => ({
        where: () => ({
          limit: (n: number) => {
            const slice = this.rows(table).slice(0, n);
            if (!projection) return Promise.resolve(slice.map((r) => ({ ...r })));
            return Promise.resolve(
              slice.map((r) => Object.fromEntries(Object.keys(projection).map((k) => [k, r[k]]))),
            );
          },
        }),
      }),
    };
  }

  update(table: unknown) {
    return {
      set: (values: Record<string, unknown>) => ({
        where: () => {
          Object.assign(this.rows(table)[0], values);
          return Promise.resolve();
        },
      }),
    };
  }
}

const GOOD = "FM2026Ab92";

let storedHash: string;

function buildService(db: FakeDb, otp: Partial<OtpService> = {}) {
  return new AuthService(
    db as never,
    new JwtService({ secret: "test-secret" }),
    otp as OtpService,
  );
}

function userRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "u-1",
    phone: "08030000000",
    fullName: "Ada Obi",
    deactivatedAt: null,
    txnPinHash: null,
    ...overrides,
  };
}

beforeAll(async () => {
  storedHash = await argon2.hash(GOOD, { type: argon2.argon2id });
}, 20000);

describe("loginCustomer", () => {
  it("accepts the stored password and issues a customer token", async () => {
    const db = new FakeDb();
    db.users = [userRow({ passwordHash: storedHash })];
    db.profiles = [{ status: "verified" }];

    const out = await buildService(db).loginCustomer({ phone: "08030000000", password: GOOD });
    expect(out.accessToken).toBeTruthy();
    expect(out.verificationStatus).toBe("verified");
  }, 20000);

  it("refuses a wrong password without saying which half was wrong", async () => {
    const db = new FakeDb();
    db.users = [userRow({ passwordHash: storedHash })];

    await expect(
      buildService(db).loginCustomer({ phone: "08030000000", password: "Wr0ngPass" }),
    ).rejects.toThrow(UnauthorizedException);
  }, 20000);

  it("points an account with no password at recovery instead of failing opaquely", async () => {
    const db = new FakeDb();
    db.users = [userRow({ passwordHash: null })];

    await expect(
      buildService(db).loginCustomer({ phone: "08030000000", password: GOOD }),
    ).rejects.toThrow(/Forgot password/);
  });
});

describe("changePassword", () => {
  it("requires the current password and then replaces the hash", async () => {
    const db = new FakeDb();
    db.users = [userRow({ passwordHash: storedHash })];
    const service = buildService(db);

    await expect(service.changePassword("u-1", "N0tMyPassword", "NewPassw0rd")).rejects.toThrow(
      BadRequestException,
    );
    expect(db.users[0].passwordHash).toBe(storedHash);

    await service.changePassword("u-1", GOOD, "NewPassw0rd");
    expect(db.users[0].passwordHash).not.toBe(storedHash);
    expect(await argon2.verify(db.users[0].passwordHash, "NewPassw0rd")).toBe(true);
    // The old credential is dead, not merely shadowed.
    expect(await argon2.verify(db.users[0].passwordHash, GOOD)).toBe(false);
  }, 30000);
});

describe("resetPassword", () => {
  it("sets a password once the phone is proven, without the old one", async () => {
    const db = new FakeDb();
    db.users = [userRow({ passwordHash: null })];
    const seen: Array<[string, string]> = [];
    const otp = {
      assertPhoneVerified: async (token: string, phone: string) => {
        seen.push([token, phone]);
        if (token !== "good-token") throw new UnauthorizedException("bad token");
      },
    };

    await expect(
      buildService(db, otp).resetPassword("08030000000", "bad-token", "BrandNew1"),
    ).rejects.toThrow(UnauthorizedException);
    expect(db.users[0].passwordHash).toBeNull();

    await buildService(db, otp).resetPassword("08030000000", "good-token", "BrandNew1");
    expect(seen).toEqual([["bad-token", "08030000000"], ["good-token", "08030000000"]]);
    expect(await argon2.verify(db.users[0].passwordHash, "BrandNew1")).toBe(true);
  }, 30000);
});
