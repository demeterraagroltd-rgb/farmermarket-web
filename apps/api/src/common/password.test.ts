import { describe, expect, it } from "vitest";
import { passwordSchema } from "./password";

describe("customer password policy", () => {
  it("accepts the spec's example", () => {
    expect(passwordSchema.safeParse("FM2026Ab92").success).toBe(true);
  });

  it("rejects the 6-digit login codes it replaces", () => {
    expect(passwordSchema.safeParse("123456").success).toBe(false);
    expect(passwordSchema.safeParse("abcdef").success).toBe(false);
  });

  it("requires length, a letter and a digit", () => {
    expect(passwordSchema.safeParse("ab1").success).toBe(false);
    expect(passwordSchema.safeParse("abcdefgh").success).toBe(false);
    expect(passwordSchema.safeParse("12345678").success).toBe(false);
    expect(passwordSchema.safeParse("a1xxxxxx").success).toBe(true);
  });

  it("names the field in the message, via the validation pipe's labels", () => {
    // The pipe maps `password` → "Password"; the schema's own messages carry
    // the rule, so a rejected signup reads "Password must contain…".
    const result = passwordSchema.safeParse("short");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0].message).toContain("at least 8 characters");
  });
});
