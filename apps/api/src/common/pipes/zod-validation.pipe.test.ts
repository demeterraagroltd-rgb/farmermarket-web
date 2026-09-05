import { describe, expect, it } from "vitest";
import { BadRequestException } from "@nestjs/common";
import { z } from "zod";
import { ZodValidationPipe } from "./zod-validation.pipe";
import { registerSchema } from "../../modules/kyc/dto/kyc.dto";
import { createOrderSchema } from "../../modules/orders/dto/create-order.dto";

function errorBodyFor(schema: z.ZodSchema, value: unknown) {
  try {
    new ZodValidationPipe(schema).transform(value);
  } catch (err) {
    expect(err).toBeInstanceOf(BadRequestException);
    return (err as BadRequestException).getResponse() as {
      message: string;
      fieldErrors: Record<string, string[]>;
      formErrors: string[];
    };
  }
  throw new Error("expected the pipe to reject this value");
}

describe("ZodValidationPipe", () => {
  it("passes valid input straight through", () => {
    const schema = z.object({ quantity: z.number() });
    expect(new ZodValidationPipe(schema).transform({ quantity: 2 })).toEqual({ quantity: 2 });
  });

  // The failure that stalled a live demo: Zod's own wording is
  // "Number must be less than or equal to 31", which names no field at all.
  it("names the field in a range error", () => {
    const body = errorBodyFor(registerSchema, {
      fullName: "Ada",
      phone: "08012345678",
      email: "ada@example.com",
      loginCode: "123456",
      salaryDay: 45,
    });
    expect(body.fieldErrors.salaryDay).toEqual([
      "Salary day of the month must be 31 or less.",
    ]);
    expect(body.message).toContain("Salary day of the month");
  });

  it("names the field in a length error rather than saying 'String'", () => {
    const body = errorBodyFor(registerSchema, {
      fullName: "Ada",
      phone: "123",
      email: "ada@example.com",
      loginCode: "123456",
    });
    expect(body.fieldErrors.phone).toEqual(["Phone number must be at least 6 characters."]);
  });

  it("reports every failure at once, not just the first", () => {
    const body = errorBodyFor(registerSchema, {
      fullName: "Ada",
      phone: "123",
      email: "not-an-email",
      loginCode: "12",
      salaryDay: 45,
    });
    expect(Object.keys(body.fieldErrors).sort()).toEqual([
      "email",
      "loginCode",
      "phone",
      "salaryDay",
    ]);
    expect(body.message.split("\n")).toHaveLength(4);
  });

  it("keeps a schema's own field-aware message verbatim", () => {
    const body = errorBodyFor(registerSchema, {
      fullName: "Ada",
      phone: "08012345678",
      email: "ada@example.com",
      loginCode: "123456",
      bvn: "123",
    });
    expect(body.fieldErrors.bvn).toEqual(["BVN must be 11 digits"]);
  });

  it("calls a missing required field required, by name", () => {
    const body = errorBodyFor(registerSchema, { phone: "08012345678" });
    expect(body.fieldErrors.fullName).toEqual(["Full name is required."]);
    expect(body.fieldErrors.email).toEqual(["Email address is required."]);
  });

  it("says which email is wrong in plain words", () => {
    const body = errorBodyFor(registerSchema, {
      fullName: "Ada",
      phone: "08012345678",
      email: "nope",
      loginCode: "123456",
    });
    expect(body.fieldErrors.email).toEqual(["Email address must be a valid email address."]);
  });

  it("points at the offending line of an order rather than an array index", () => {
    const body = errorBodyFor(createOrderSchema, {
      items: [{ productId: "9dcb9f2e-2c9f-4d1e-8b0f-7a1f5e6c1a11", quantity: 0 }],
      deliveryAddress: "1 Test Road, Ikeja",
      bnplPlanId: "5cfd2942-d4c2-4797-903b-b15c4aa6c9da",
      txnPin: "1234",
    });
    expect(body.fieldErrors["items.0.quantity"]?.[0]).toContain("Quantity for item 1");
  });

  it("labels a nested address field with its form label", () => {
    const schema = z.object({
      residentialAddress: z.object({
        street: z.string().min(1),
        city: z.string().min(1),
        state: z.string().min(1),
        lga: z.string().min(1),
      }),
    });
    const body = errorBodyFor(schema, {
      residentialAddress: { street: "", city: "Lagos", state: "Lagos", lga: "Ikeja" },
    });
    expect(body.fieldErrors["residentialAddress.street"]).toEqual(["Street address is required."]);
  });

  it("lists the allowed values for an enum", () => {
    const body = errorBodyFor(registerSchema, {
      fullName: "Ada",
      phone: "08012345678",
      email: "ada@example.com",
      loginCode: "123456",
      employmentType: "Freelance",
    });
    expect(body.fieldErrors.employmentType?.[0]).toBe(
      "Employment type must be one of: Government, Private, Self-employed.",
    );
  });
});
