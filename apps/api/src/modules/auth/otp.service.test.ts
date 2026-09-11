import { describe, expect, it, beforeEach } from "vitest";
import { JwtService } from "@nestjs/jwt";
import { OtpService } from "./otp.service";
import { FakeSmsSender } from "../integrations/sms/fake.sms";

// OtpService only touches one table (`phone_verifications`) through four
// chains: select→where→orderBy→limit, delete→where, insert→values,
// update→set→where. This fake keeps the rows in an array and interprets the
// operations structurally. The service always reads a row and then updates
// *that* row, so update() applies to the last row limit(1) returned — which
// is all the where-clause would have selected anyway.
class FakeDb {
  rows: any[] = [];
  private lastReadId: string | null = null;
  private idSeq = 0;

  select(projection?: Record<string, unknown>) {
    return {
      from: () => ({
        where: () => ({
          orderBy: () => ({
            limit: (n: number) => {
              const sorted = [...this.rows].sort(
                (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
              );
              const slice = sorted.slice(0, n);
              this.lastReadId = slice[0]?.id ?? null;
              // Return copies — real drizzle hands back plain result objects,
              // not live references, so the service's `row` stays a snapshot
              // and a later update() doesn't retroactively mutate it.
              if (!projection) return Promise.resolve(slice.map((r) => ({ ...r })));
              return Promise.resolve(
                slice.map((r) =>
                  Object.fromEntries(Object.keys(projection).map((k) => [k, r[k]])),
                ),
              );
            },
          }),
        }),
      }),
    };
  }

  delete() {
    return {
      where: () => {
        // OtpService only ever deletes unconsumed rows for the phone/purpose.
        this.rows = this.rows.filter((r) => r.consumedAt != null);
        return Promise.resolve();
      },
    };
  }

  insert() {
    return {
      values: (v: any) => {
        this.rows.push({
          id: `pv-${this.idSeq++}`,
          attempts: 0,
          consumedAt: null,
          createdAt: new Date(),
          ...v,
        });
        return Promise.resolve();
      },
    };
  }

  update() {
    return {
      set: (patch: any) => ({
        where: () => {
          const target = this.rows.find((r) => r.id === this.lastReadId);
          if (target) Object.assign(target, patch);
          return Promise.resolve();
        },
      }),
    };
  }
}

function makeService() {
  const db = new FakeDb();
  const sms = new FakeSmsSender();
  const jwt = new JwtService({ secret: "test-secret" });
  const service = new OtpService(db as any, sms, jwt);
  return { service, db, sms, jwt };
}

describe("OtpService", () => {
  let ctx: ReturnType<typeof makeService>;
  beforeEach(() => {
    ctx = makeService();
  });

  it("texts a code and stores only its hash, never the code itself", async () => {
    const res = await ctx.service.request("08012345678", "register");
    expect(res.expiresInSeconds).toBe(600);

    const msg = ctx.sms.last!;
    expect(msg.to).toBe("2348012345678"); // normalised
    const code = msg.message.match(/\b(\d{6})\b/)![1];

    expect(ctx.db.rows).toHaveLength(1);
    expect(ctx.db.rows[0].codeHash).not.toContain(code);
    expect(ctx.db.rows[0].codeHash.startsWith("$argon2")).toBe(true);
  });

  it("throttles a second request inside the cooldown", async () => {
    await ctx.service.request("08012345678", "register");
    await expect(ctx.service.request("08012345678", "register")).rejects.toThrow(
      /wait .* before requesting another code/i,
    );
  });

  it("still stores the code (recoverable from the log) when the SMS provider fails", async () => {
    const db = new FakeDb();
    const jwt = new JwtService({ secret: "test-secret" });
    const brokenSms = {
      live: true,
      send: () => Promise.reject(new Error("Termii: Sender Id not approved")),
    };
    const service = new OtpService(db as any, brokenSms as any, jwt);

    const res = await service.request("08012345678", "register");
    expect(res.sent).toBe(false);
    expect(res.deliveryFailed).toBe(true);
    // The code is still stored so a stuck Sign Up is recoverable, and
    // verify() will accept it.
    expect(db.rows).toHaveLength(1);
  });

  it("verifies a correct code and returns a token that assertPhoneVerified accepts", async () => {
    await ctx.service.request("08012345678", "register");
    const code = ctx.sms.last!.message.match(/\b(\d{6})\b/)![1];

    const { verified, verificationToken } = await ctx.service.verify(
      "0801 234 5678", // different formatting, same number
      code,
      "register",
    );
    expect(verified).toBe(true);
    expect(ctx.db.rows[0].consumedAt).toBeInstanceOf(Date);

    await expect(
      ctx.service.assertPhoneVerified(verificationToken, "+2348012345678", "register"),
    ).resolves.toBeUndefined();
  });

  it("rejects a wrong code and counts down the remaining tries", async () => {
    await ctx.service.request("08012345678", "register");
    await expect(ctx.service.verify("08012345678", "000000", "register")).rejects.toThrow(
      /Incorrect code\. 4 tries left/,
    );
    expect(ctx.db.rows[0].attempts).toBe(1);
  });

  it("kills the code after too many wrong tries", async () => {
    await ctx.service.request("08012345678", "register");
    for (let i = 0; i < 5; i++) {
      await expect(
        ctx.service.verify("08012345678", "000000", "register"),
      ).rejects.toThrow();
    }
    await expect(ctx.service.verify("08012345678", "000000", "register")).rejects.toThrow(
      /Too many wrong tries/,
    );
  });

  it("rejects an expired code", async () => {
    await ctx.service.request("08012345678", "register");
    const code = ctx.sms.last!.message.match(/\b(\d{6})\b/)![1];
    ctx.db.rows[0].expiresAt = new Date(Date.now() - 1000);
    await expect(ctx.service.verify("08012345678", code, "register")).rejects.toThrow(/expired/);
  });

  it("tells the user to request a code when none exists", async () => {
    await expect(ctx.service.verify("08012345678", "123456", "register")).rejects.toThrow(
      /Request a code first/,
    );
  });

  describe("assertPhoneVerified", () => {
    it("throws when no token is supplied", async () => {
      await expect(
        ctx.service.assertPhoneVerified(undefined, "08012345678", "register"),
      ).rejects.toThrow(/Verify your phone number/);
    });

    it("throws on a garbage token", async () => {
      await expect(
        ctx.service.assertPhoneVerified("not-a-jwt", "08012345678", "register"),
      ).rejects.toThrow(/expired/);
    });

    it("throws when the token is for a different number", async () => {
      const token = ctx.jwt.sign({
        sub: "2349999999999",
        purpose: "register",
        kind: "phone_verification",
      });
      await expect(
        ctx.service.assertPhoneVerified(token, "08012345678", "register"),
      ).rejects.toThrow(/doesn't match/);
    });

    it("throws when the token was minted for a different purpose", async () => {
      const token = ctx.jwt.sign({
        sub: "2348012345678",
        purpose: "login",
        kind: "phone_verification",
      });
      await expect(
        ctx.service.assertPhoneVerified(token, "08012345678", "register"),
      ).rejects.toThrow(/can't be used here/);
    });
  });
});
