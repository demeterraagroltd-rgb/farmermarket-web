import { describe, expect, it } from "vitest";
import { bvnLookupStartSchema, updateKycSchema } from "./dto/kyc.dto";

describe("bvnLookupStartSchema", () => {
  it("allows using the saved BVN without sending it from the browser", () => {
    expect(bvnLookupStartSchema.safeParse({}).success).toBe(true);
  });

  it("still validates a BVN supplied for a legacy profile", () => {
    expect(bvnLookupStartSchema.safeParse({ bvn: "12345678901" }).success).toBe(true);
    expect(bvnLookupStartSchema.safeParse({ bvn: "123" }).success).toBe(false);
    expect(bvnLookupStartSchema.safeParse({ bvn: "" }).success).toBe(false);
  });
});

// The point of these is that a state/LGA pair is validated as a unit and
// stored in its official spelling, so "Abuja", "AMAC" and "Abuja Municipal"
// can never land in the same column as three different places.

const ADDRESS = { street: "12 Awolowo Way", city: "Ikeja" };

describe("updateKycSchema — residential address", () => {
  it("canonicalises loose but real input", () => {
    const r = updateKycSchema.safeParse({
      residentialAddress: { ...ADDRESS, state: "  lagos ", lga: "IKEJA" },
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.residentialAddress).toMatchObject({ state: "Lagos", lga: "Ikeja" });
    }
  });

  it("rejects an LGA that belongs to a different state", () => {
    // Ikeja is real — just not in Abia.
    const r = updateKycSchema.safeParse({
      residentialAddress: { ...ADDRESS, state: "Abia", lga: "Ikeja" },
    });
    expect(r.success).toBe(false);
  });

  it("rejects the inconsistent FCT spellings", () => {
    for (const lga of ["Abuja", "AMAC", "Abuja Municipal", "AMAC LGA"]) {
      const r = updateKycSchema.safeParse({
        residentialAddress: { ...ADDRESS, state: "Federal Capital Territory", lga },
      });
      expect(r.success, `${lga} should be rejected`).toBe(false);
    }
  });

  it("accepts the official FCT municipal council name", () => {
    const r = updateKycSchema.safeParse({
      residentialAddress: {
        ...ADDRESS,
        state: "Federal Capital Territory",
        lga: "municipal area council",
      },
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.residentialAddress?.lga).toBe("Municipal Area Council");
    }
  });

  it("rejects a state that isn't one", () => {
    const r = updateKycSchema.safeParse({
      residentialAddress: { ...ADDRESS, state: "Abuja", lga: "Garki" },
    });
    expect(r.success).toBe(false);
  });
});

describe("updateKycSchema — state of origin", () => {
  it("canonicalises the state", () => {
    const r = updateKycSchema.safeParse({ stateOfOrigin: "federal capital territory" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.stateOfOrigin).toBe("Federal Capital Territory");
  });

  it("rejects an unknown state", () => {
    expect(updateKycSchema.safeParse({ stateOfOrigin: "Lagosia" }).success).toBe(false);
  });

  it("trims the LGA of origin", () => {
    const r = updateKycSchema.safeParse({ lgaOfOrigin: "  Kuje  " });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.lgaOfOrigin).toBe("Kuje");
  });
});

describe("updateKycSchema — employment fields", () => {
  it("rejects a blank employer or job title", () => {
    // They're optional in this schema (it backs partial PATCH) but an empty
    // string must not pass as "filled in" — that's how a blank employer used
    // to reach the review workspace.
    expect(updateKycSchema.safeParse({ employer: "   " }).success).toBe(false);
    expect(updateKycSchema.safeParse({ jobTitle: "" }).success).toBe(false);
  });

  it("accepts a real employer and trims it", () => {
    const r = updateKycSchema.safeParse({ employer: "  FCDA  ", jobTitle: "Administrative Officer" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.employer).toBe("FCDA");
  });

  it("rejects a non-positive salary", () => {
    expect(updateKycSchema.safeParse({ netMonthlySalaryNaira: 0 }).success).toBe(false);
    expect(updateKycSchema.safeParse({ netMonthlySalaryNaira: -1 }).success).toBe(false);
  });
});
