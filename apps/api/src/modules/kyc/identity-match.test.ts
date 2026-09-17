import { describe, expect, it } from "vitest";
import { matchIdentity, type DeclaredIdentity } from "./identity-match";
import type { IdentityRecord } from "../integrations/mono-lookup/lookup.types";

const RECORD: IdentityRecord = {
  source: "bvn",
  firstName: "ADA",
  lastName: "OKONKWO",
  middleName: "NGOZI",
  dateOfBirth: "1992-04-28",
  gender: "Female",
  phone: "08031234512",
  nin: "22222222222",
};

const DECLARED: DeclaredIdentity = {
  fullName: "Ada Ngozi Okonkwo",
  dateOfBirth: "1992-04-28",
  gender: "female",
  phone: "08031234512",
  nin: "22222222222",
};

const live = { live: true };

describe("matchIdentity", () => {
  it("calls a full agreement an exact match", () => {
    const c = matchIdentity(RECORD, DECLARED, live);
    expect(c.nameMatch).toBe("exact");
    expect(c.dateOfBirthMatch).toBe(true);
    expect(c.genderMatch).toBe(true);
    expect(c.phoneMatch).toBe(true);
    expect(c.ninCorroborated).toBe(true);
    expect(c.verdict).toBe("match");
  });

  it("treats an undeclared middle name as partial, not a failure", () => {
    const c = matchIdentity(RECORD, { ...DECLARED, fullName: "Ada Okonkwo" }, live);
    expect(c.nameMatch).toBe("partial");
    expect(c.verdict).toBe("partial");
  });

  it("accepts a surname change as partial when the first name still holds", () => {
    const c = matchIdentity(RECORD, { ...DECLARED, fullName: "Ada Ngozi Adeyemi" }, live);
    expect(c.nameMatch).toBe("partial");
  });

  it("rejects a different person outright", () => {
    const c = matchIdentity(RECORD, { ...DECLARED, fullName: "Chinedu Balogun" }, live);
    expect(c.nameMatch).toBe("mismatch");
    expect(c.verdict).toBe("mismatch");
  });

  it("fails the whole check on a wrong date of birth even when the name is exact", () => {
    const c = matchIdentity(RECORD, { ...DECLARED, dateOfBirth: "1988-01-02" }, live);
    expect(c.nameMatch).toBe("exact");
    expect(c.dateOfBirthMatch).toBe(false);
    expect(c.verdict).toBe("mismatch");
  });

  it("ignores titles when comparing names", () => {
    const c = matchIdentity(RECORD, { ...DECLARED, fullName: "Mrs Ada Ngozi Okonkwo" }, live);
    expect(c.nameMatch).toBe("exact");
  });

  it("matches phone numbers across local and +234 forms", () => {
    const c = matchIdentity({ ...RECORD, phone: "+2348031234512" }, DECLARED, live);
    expect(c.phoneMatch).toBe(true);
  });

  it("reports null rather than false when a field is missing on either side", () => {
    const c = matchIdentity(
      { ...RECORD, gender: null, phone: null, nin: null },
      { ...DECLARED, dateOfBirth: null },
      live,
    );
    expect(c.dateOfBirthMatch).toBeNull();
    expect(c.genderMatch).toBeNull();
    expect(c.phoneMatch).toBeNull();
    expect(c.ninCorroborated).toBeNull();
    // Unverifiable is not the same as wrong: an exact name with nothing else
    // to check is "partial", never "match".
    expect(c.verdict).toBe("partial");
  });

  it("does not compare an unparseable record date of birth", () => {
    const c = matchIdentity({ ...RECORD, dateOfBirth: "28/04/1992" }, DECLARED, live);
    expect(c.dateOfBirthMatch).toBeNull();
    expect(c.verdict).toBe("partial");
  });

  it("carries the fake-client flag through so a reviewer can see it", () => {
    const c = matchIdentity(RECORD, DECLARED, { live: false });
    expect(c.live).toBe(false);
  });

  it("keeps the record name for a human to read", () => {
    expect(matchIdentity(RECORD, DECLARED, live).recordName).toBe("ADA NGOZI OKONKWO");
  });
});
