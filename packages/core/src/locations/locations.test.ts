import { describe, expect, it } from "vitest";
import {
  STATE_NAMES,
  STATES_AND_LGAS,
  canonicalLga,
  canonicalState,
  isValidStateLgaPair,
  lgasForState,
} from "./index.js";

describe("locations dataset", () => {
  it("covers all 36 states plus the FCT", () => {
    expect(STATE_NAMES).toHaveLength(37);
    expect(STATE_NAMES).toContain("Federal Capital Territory");
    expect(STATE_NAMES).toContain("Lagos");
  });

  it("holds all 774 LGAs", () => {
    const total = STATES_AND_LGAS.reduce((n, s) => n + s.lgas.length, 0);
    expect(total).toBe(774);
  });

  it("has no duplicate LGA within a state", () => {
    for (const s of STATES_AND_LGAS) {
      expect(new Set(s.lgas.map((l) => l.toLowerCase())).size).toBe(s.lgas.length);
    }
  });
});

describe("canonicalState", () => {
  it("returns the official spelling for loose input", () => {
    expect(canonicalState("fct")).toBeNull(); // not an official name — see canonicalLga
    expect(canonicalState("  lagos  ")).toBe("Lagos");
    expect(canonicalState("FEDERAL CAPITAL TERRITORY")).toBe("Federal Capital Territory");
  });

  it("rejects anything that isn't a state", () => {
    expect(canonicalState("Abuja")).toBeNull();
    expect(canonicalState("Nigeria")).toBeNull();
    expect(canonicalState("")).toBeNull();
    expect(canonicalState(null)).toBeNull();
  });
});

describe("canonicalLga", () => {
  it("normalises the FCT municipal council", () => {
    expect(canonicalLga("Federal Capital Territory", "municipal area council")).toBe(
      "Municipal Area Council",
    );
    expect(canonicalLga("federal capital territory", "  KWALI ")).toBe("Kwali");
  });

  it("validates the LGA against that state, not a flat set", () => {
    // "Ikeja" is a real LGA — of Lagos, not of Abia.
    expect(canonicalLga("Lagos", "Ikeja")).toBe("Ikeja");
    expect(canonicalLga("Abia", "Ikeja")).toBeNull();
  });

  it("rejects the inconsistent spellings this dataset exists to prevent", () => {
    expect(canonicalLga("Federal Capital Territory", "Abuja")).toBeNull();
    expect(canonicalLga("Federal Capital Territory", "AMAC")).toBeNull();
    expect(canonicalLga("Federal Capital Territory", "Abuja Municipal")).toBeNull();
    expect(canonicalLga("Federal Capital Territory", "AMAC LGA")).toBeNull();
  });

  it("returns null for unknown states and empty input", () => {
    expect(canonicalLga("Wakanda", "Ikeja")).toBeNull();
    expect(canonicalLga("Lagos", "")).toBeNull();
    expect(canonicalLga(null, "Ikeja")).toBeNull();
  });
});

describe("lgasForState", () => {
  it("is case-insensitive and sorted", () => {
    const lgas = lgasForState("lagos");
    expect(lgas.length).toBeGreaterThan(10);
    expect(lgas[0]).toBe("Agege");
    expect(lgas).toContain("Ikeja");
  });

  it("returns empty for an unknown or missing state", () => {
    expect(lgasForState("Wakanda")).toEqual([]);
    expect(lgasForState(null)).toEqual([]);
  });
});

describe("isValidStateLgaPair", () => {
  it("agrees with canonicalLga", () => {
    expect(isValidStateLgaPair("Lagos", "Ikeja")).toBe(true);
    expect(isValidStateLgaPair("Abia", "Ikeja")).toBe(false);
  });
});
