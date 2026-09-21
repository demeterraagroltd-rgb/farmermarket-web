import { describe, expect, it } from "vitest";
import {
  bankConnectionState,
  compareIncome,
  employmentState,
  freshnessOf,
  identityStatuses,
  lastFinancialSync,
  maskTail,
  summariseRepayments,
} from "./customer-360";
import type { IdentityCheck } from "../kyc/identity-match";

const check = (over: Partial<IdentityCheck> = {}): IdentityCheck => ({
  checkedAt: "2026-09-21T10:00:00.000Z",
  source: "bvn",
  live: true,
  recordName: "ADA OKONKWO",
  nameMatch: "exact",
  dateOfBirthMatch: true,
  genderMatch: true,
  phoneMatch: true,
  ninCorroborated: null,
  verdict: "match",
  ...over,
});

describe("maskTail", () => {
  it("keeps only the last four", () => {
    expect(maskTail("12345678901")).toBe("•••••••8901");
  });
  it("never reveals a value that is no longer than the visible part", () => {
    expect(maskTail("1234")).toBe("••••");
    expect(maskTail("12")).toBe("••");
  });
  it("passes through absence", () => {
    expect(maskTail(null)).toBeNull();
    expect(maskTail("")).toBeNull();
  });
});

describe("identityStatuses", () => {
  it("separates 'never provided' from 'provided but unchecked'", () => {
    const none = identityStatuses({ hasBvn: false, hasNin: false, identityLookup: null });
    expect(none.bvn.state).toBe("not_provided");
    expect(none.nin.state).toBe("not_provided");
    expect(none.mashup.state).toBe("not_provided");

    const given = identityStatuses({ hasBvn: true, hasNin: true, identityLookup: null });
    expect(given.bvn.state).toBe("unverified");
    expect(given.nin.state).toBe("unverified");
    expect(given.mashup.state).toBe("unverified");
  });

  it("credits a BVN check to BVN only", () => {
    const s = identityStatuses({ hasBvn: true, hasNin: true, identityLookup: check({ source: "bvn" }) });
    expect(s.bvn.state).toBe("verified");
    expect(s.bvn.verifiedAt).toBe("2026-09-21T10:00:00.000Z");
    expect(s.nin.state).toBe("unverified");
    expect(s.mashup.state).toBe("unverified");
  });

  it("credits a NIN check to NIN only", () => {
    const s = identityStatuses({ hasBvn: true, hasNin: true, identityLookup: check({ source: "nin" }) });
    expect(s.nin.state).toBe("verified");
    expect(s.bvn.state).toBe("unverified");
  });

  it("credits a Mashup check to BVN, NIN and Mashup — it cross-checks all three", () => {
    const s = identityStatuses({ hasBvn: true, hasNin: true, identityLookup: check({ source: "mashup" }) });
    expect(s.bvn.state).toBe("verified");
    expect(s.nin.state).toBe("verified");
    expect(s.mashup.state).toBe("verified");
  });

  it("maps partial and mismatch verdicts through", () => {
    expect(
      identityStatuses({ hasBvn: true, hasNin: false, identityLookup: check({ verdict: "partial" }) }).bvn.state,
    ).toBe("partial");
    expect(
      identityStatuses({ hasBvn: true, hasNin: false, identityLookup: check({ verdict: "mismatch" }) }).bvn.state,
    ).toBe("mismatch");
  });

  it("never counts a sandbox result as verified, whatever its verdict", () => {
    const s = identityStatuses({ hasBvn: true, hasNin: false, identityLookup: check({ live: false }) });
    expect(s.bvn.state).toBe("unverified");
    expect(s.bvn.sandbox).toBe(true);
  });

  it("carries the field-level comparison for the panel", () => {
    const s = identityStatuses({
      hasBvn: true,
      hasNin: false,
      identityLookup: check({ nameMatch: "partial", dateOfBirthMatch: false, phoneMatch: null }),
    });
    expect(s.bvn.nameMatch).toBe("partial");
    expect(s.bvn.dateOfBirthMatch).toBe(false);
    expect(s.bvn.phoneMatch).toBeNull();
  });
});

describe("identityStatuses — from history", () => {
  const at = (h: number) => new Date(Date.UTC(2026, 8, 21, h)).toISOString();

  it("keeps a BVN check when a NIN check is run afterwards (the old single-slot limitation)", () => {
    const s = identityStatuses({
      hasBvn: true,
      hasNin: true,
      history: { bvn: check({ source: "bvn", checkedAt: at(9) }), nin: check({ source: "nin", checkedAt: at(10) }) },
    });
    expect(s.bvn.state).toBe("verified");
    expect(s.nin.state).toBe("verified");
    expect(s.mashup.state).toBe("unverified");
  });

  it("takes the more recent of the BVN and Mashup checks for the BVN", () => {
    const newerBvn = identityStatuses({
      hasBvn: true,
      hasNin: true,
      history: {
        mashup: check({ source: "mashup", checkedAt: at(8) }),
        bvn: check({ source: "bvn", checkedAt: at(11), verdict: "mismatch" }),
      },
    });
    expect(newerBvn.bvn.state).toBe("mismatch"); // the later, failing check wins
    expect(newerBvn.nin.state).toBe("verified"); // NIN is still covered by the Mashup

    const newerMashup = identityStatuses({
      hasBvn: true,
      hasNin: true,
      history: {
        bvn: check({ source: "bvn", checkedAt: at(8), verdict: "mismatch" }),
        mashup: check({ source: "mashup", checkedAt: at(11) }),
      },
    });
    expect(newerMashup.bvn.state).toBe("verified");
  });

  it("prefers the history over the legacy profile column when both exist", () => {
    const s = identityStatuses({
      hasBvn: true,
      hasNin: false,
      history: { bvn: check({ source: "bvn", verdict: "partial" }) },
      identityLookup: check({ source: "bvn", verdict: "match" }),
    });
    expect(s.bvn.state).toBe("partial");
  });

  it("falls back to the legacy column when there is no history", () => {
    const s = identityStatuses({ hasBvn: true, hasNin: false, history: {}, identityLookup: check({ source: "bvn" }) });
    expect(s.bvn.state).toBe("verified");
  });
});

describe("bankConnectionState", () => {
  it("is connected once there is a Mono account", () => {
    expect(bankConnectionState({ monoAccountId: "acc_1", bankLinkRequestedAt: null })).toBe("connected");
    expect(bankConnectionState({ monoAccountId: "acc_1", bankLinkRequestedAt: new Date() })).toBe("connected");
  });
  it("is requested when asked for but not yet linked", () => {
    expect(bankConnectionState({ monoAccountId: null, bankLinkRequestedAt: new Date() })).toBe("requested");
  });
  it("is not connected otherwise", () => {
    expect(bankConnectionState({ monoAccountId: null, bankLinkRequestedAt: null })).toBe("not_connected");
  });
});

describe("employmentState", () => {
  const full = { employmentType: "Private", employer: "Acme", jobTitle: "Analyst", netMonthlySalaryKobo: 25_000_000n };
  it("is complete only with all four facts", () => {
    expect(employmentState(full)).toBe("complete");
  });
  it("is partial when some are missing", () => {
    expect(employmentState({ ...full, jobTitle: null })).toBe("partial");
    expect(employmentState({ ...full, employer: "" })).toBe("partial");
  });
  it("is not_provided when none are given", () => {
    expect(
      employmentState({ employmentType: null, employer: null, jobTitle: null, netMonthlySalaryKobo: null }),
    ).toBe("not_provided");
  });
  it("counts a real salary of zero as provided, not absent", () => {
    expect(employmentState({ ...full, netMonthlySalaryKobo: 0n })).toBe("complete");
  });
});

describe("lastFinancialSync", () => {
  it("prefers the analysis timestamp", () => {
    expect(
      lastFinancialSync({ bankAnalysis: { pulledAt: "2026-09-21T09:00:00.000Z" }, bankLinkedAt: new Date("2026-09-01") }),
    ).toBe("2026-09-21T09:00:00.000Z");
  });
  it("falls back to when the account was linked", () => {
    expect(lastFinancialSync({ bankAnalysis: null, bankLinkedAt: new Date("2026-09-01T00:00:00.000Z") })).toBe(
      "2026-09-01T00:00:00.000Z",
    );
  });
  it("is null when nothing was ever pulled", () => {
    expect(lastFinancialSync({ bankAnalysis: null, bankLinkedAt: null })).toBeNull();
  });
});

describe("freshnessOf", () => {
  const now = new Date("2026-09-21T12:00:00.000Z");
  it("is 'never' with no timestamp or an unparseable one", () => {
    expect(freshnessOf(null, now).state).toBe("never");
    expect(freshnessOf("not a date", now).state).toBe("never");
  });
  it("is fresh inside the window, with the age in seconds", () => {
    const f = freshnessOf("2026-09-21T10:00:00.000Z", now, 24);
    expect(f.state).toBe("fresh");
    expect(f.ageSeconds).toBe(7200);
  });
  it("is stale once the window has passed", () => {
    expect(freshnessOf("2026-09-20T11:00:00.000Z", now, 24).state).toBe("stale");
  });
  it("treats exactly the window as still fresh", () => {
    expect(freshnessOf("2026-09-20T12:00:00.000Z", now, 24).state).toBe("fresh");
  });
  it("never reports a negative age for a clock-skewed future timestamp", () => {
    expect(freshnessOf("2026-09-21T13:00:00.000Z", now).ageSeconds).toBe(0);
  });
});

describe("compareIncome", () => {
  it("matches within 15%", () => {
    const c = compareIncome(25_000_000, 25_000_000);
    expect(c.band).toBe("matches");
    expect(c.differenceKobo).toBe(0);
    expect(compareIncome(25_000_000, 28_000_000).band).toBe("matches");
  });
  it("is moderate up to 40%, large beyond", () => {
    expect(compareIncome(25_000_000, 32_000_000).band).toBe("moderate");
    expect(compareIncome(25_000_000, 40_000_000).band).toBe("large");
  });
  it("signs the difference: positive when the bank shows more than declared", () => {
    expect(compareIncome(25_000_000, 30_000_000).differenceKobo).toBe(5_000_000);
    expect(compareIncome(25_000_000, 20_000_000).differenceKobo).toBe(-5_000_000);
  });
  it("is 'unknown' — not 'matches' — when either side is missing", () => {
    expect(compareIncome(null, 25_000_000).band).toBe("unknown");
    expect(compareIncome(25_000_000, null).band).toBe("unknown");
    expect(compareIncome(0, 25_000_000).band).toBe("unknown");
  });
});

describe("summariseRepayments", () => {
  const day = 86_400_000;
  const now = Date.now();
  it("is 'none' with no schedules", () => {
    expect(summariseRepayments([]).collectionStatus).toBe("none");
  });
  it("totals financed, repaid and outstanding", () => {
    const s = summariseRepayments([
      { amount: 5000, amountPaid: 5000, dueDate: new Date(now - 10 * day), isPaid: true, isOverdue: false },
      { amount: 5000, amountPaid: 1000.5, dueDate: new Date(now + 5 * day), isPaid: false, isOverdue: false },
    ]);
    expect(s.totalFinanced).toBe(10000);
    expect(s.totalRepaid).toBe(6000.5);
    expect(s.outstanding).toBe(3999.5);
    expect(s.collectionStatus).toBe("current");
  });
  it("picks the earliest unpaid instalment as next, with the amount still due", () => {
    const later = new Date(now + 40 * day);
    const sooner = new Date(now + 10 * day);
    const s = summariseRepayments([
      { amount: 3000, amountPaid: 0, dueDate: later, isPaid: false, isOverdue: false },
      { amount: 3000, amountPaid: 500, dueDate: sooner, isPaid: false, isOverdue: false },
    ]);
    expect(s.nextPayment).toEqual({ dueDate: sooner.toISOString(), amountDue: 2500 });
  });
  it("flags overdue over everything else", () => {
    const s = summariseRepayments([
      { amount: 3000, amountPaid: 0, dueDate: new Date(now - 3 * day), isPaid: false, isOverdue: true },
      { amount: 3000, amountPaid: 0, dueDate: new Date(now + 3 * day), isPaid: false, isOverdue: false },
    ]);
    expect(s.overdueCount).toBe(1);
    expect(s.collectionStatus).toBe("overdue");
  });
  it("is paid_up with nothing left to collect", () => {
    const s = summariseRepayments([
      { amount: 3000, amountPaid: 3000, dueDate: new Date(now - day), isPaid: true, isOverdue: false },
    ]);
    expect(s.collectionStatus).toBe("paid_up");
    expect(s.nextPayment).toBeNull();
    expect(s.outstanding).toBe(0);
  });
});
