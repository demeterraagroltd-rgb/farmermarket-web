import { describe, expect, it } from "vitest";
import { customerLoginSchema } from "./customer-login.dto";

describe("customerLoginSchema", () => {
  it("accepts the current field name", () => {
    expect(customerLoginSchema.parse({ phone: "0803", password: "Abcd1234" })).toEqual({
      phone: "0803",
      password: "Abcd1234",
    });
  });

  it("maps the legacy `code` field onto password, so old phone-app builds still sign in", () => {
    expect(customerLoginSchema.parse({ phone: "0803", code: "123456" })).toEqual({
      phone: "0803",
      password: "123456",
    });
  });

  it("prefers password when a client sends both", () => {
    expect(customerLoginSchema.parse({ phone: "0803", password: "Abcd1234", code: "123456" })).toEqual({
      phone: "0803",
      password: "Abcd1234",
    });
  });

  it("still rejects an empty or missing credential", () => {
    expect(customerLoginSchema.safeParse({ phone: "0803", code: "" }).success).toBe(false);
    expect(customerLoginSchema.safeParse({ phone: "0803" }).success).toBe(false);
  });

  it("applies no password policy — a short legacy code must reach the hash check", () => {
    expect(customerLoginSchema.safeParse({ phone: "0803", password: "1" }).success).toBe(true);
  });
});
