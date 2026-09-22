import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BadRequestException } from "@nestjs/common";
import { HttpMonoClient } from "./http-mono.client";

// Regression coverage for a real production failure: every sync's transactions
// call was rejected by Mono as "Incomplete period range" because the request
// sent `start` with no `end` — Mono treats a period as both dates or neither.
// This is the one client every account and every sync goes through, so it's
// exercised directly against a mocked `fetch` rather than only through the
// fake client the rest of the suite uses.

/** The spy form, for a test that inspects the call (e.g. the query string). */
function mockFetchSpy(body: unknown, ok = true, status = 200) {
  return vi.fn(async (_url: string) => ({
    ok,
    status,
    text: async () => JSON.stringify(body),
  }));
}
/** The plain `global.fetch` form, for a test that only cares about the response. */
function mockFetch(body: unknown, ok = true, status = 200): typeof fetch {
  return mockFetchSpy(body, ok, status) as unknown as typeof fetch;
}

describe("HttpMonoClient", () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
    vi.useRealTimers();
  });

  describe("getTransactions", () => {
    it("sends both start and end — Mono rejects one without the other", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-09-22T12:00:00Z"));
      const fetchMock = mockFetchSpy({ status: "success", data: [] });
      global.fetch = fetchMock as unknown as typeof fetch;

      const client = new HttpMonoClient("sk_test");
      await client.getTransactions("acc_1", 6);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const url = new URL((fetchMock.mock.calls[0][0] as string));
      // dd-mm-yyyy — Mono's own example is "05-01-2020"; ISO (2026-03-22) is
      // rejected as "Invalid date format".
      expect(url.searchParams.get("start")).toBe("22-03-2026");
      expect(url.searchParams.get("end")).toBe("22-09-2026");
      expect(url.searchParams.get("paginate")).toBe("false");
    });

    it("pads single-digit days and months to two digits", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-01-05T00:00:00Z"));
      const fetchMock = mockFetchSpy({ status: "success", data: [] });
      global.fetch = fetchMock as unknown as typeof fetch;

      await new HttpMonoClient("sk_test").getTransactions("acc_1", 1);

      const url = new URL(fetchMock.mock.calls[0][0] as string);
      expect(url.searchParams.get("start")).toBe("05-12-2025");
      expect(url.searchParams.get("end")).toBe("05-01-2026");
    });

    it("maps Mono's transaction shape, including a missing id and category", async () => {
      global.fetch = mockFetch({
        status: "success",
        data: [{ _id: "t1", amount: 250000, type: "credit", narration: "SALARY", date: "2026-09-01", balance: 500000, category: "transfer" }, { amount: 1000, type: "debit", narration: "POS", date: "2026-09-02" }],
      });
      const client = new HttpMonoClient("sk_test");
      const rows = await client.getTransactions("acc_1", 6);
      expect(rows).toEqual([
        { id: "t1", category: "transfer", amountKobo: 250000, type: "credit", narration: "SALARY", date: "2026-09-01", balanceKobo: 500000 },
        { id: null, category: null, amountKobo: 1000, type: "debit", narration: "POS", date: "2026-09-02", balanceKobo: null },
      ]);
    });

    it("captures the raw response when asked", async () => {
      const body = { status: "success", data: [] };
      global.fetch = mockFetch(body);
      const client = new HttpMonoClient("sk_test");
      const captured: unknown[] = [];
      await client.getTransactions("acc_1", 6, (endpoint, raw) => captured.push([endpoint, raw]));
      expect(captured).toEqual([["transactions", body]]);
    });
  });

  describe("error handling", () => {
    it("turns a non-ok response into a BadRequestException naming Mono", async () => {
      global.fetch = mockFetch({ message: "Incomplete period range" }, false, 400);
      const client = new HttpMonoClient("sk_test");
      await expect(client.getTransactions("acc_1", 6)).rejects.toThrow(BadRequestException);
      await expect(client.getTransactions("acc_1", 6)).rejects.toThrow(/Mono: Incomplete period range/);
    });

    it("treats a 200 with status: failed the same as a non-ok response", async () => {
      global.fetch = mockFetch({ status: "failed", message: "account disconnected" });
      const client = new HttpMonoClient("sk_test");
      await expect(client.getAccountDetails("acc_1")).rejects.toThrow(/Mono: account disconnected/);
    });

    it("getIncome swallows an error rather than failing the whole sync", async () => {
      global.fetch = mockFetch({ message: "not enabled" }, false, 403);
      const client = new HttpMonoClient("sk_test");
      await expect(client.getIncome("acc_1")).resolves.toBeNull();
    });
  });

  describe("getAccountDetails", () => {
    it("maps Mono's account shape and takes the last 4 of the account number", async () => {
      global.fetch = mockFetch({
        status: "success",
        data: { account: { name: "ADA OKONKWO", accountNumber: "0123454321", currency: "NGN", balance: 500000, institution: { name: "GTBank" } } },
      });
      const client = new HttpMonoClient("sk_test");
      const details = await client.getAccountDetails("acc_1");
      expect(details).toEqual({
        accountId: "acc_1",
        name: "ADA OKONKWO",
        accountNumberLast4: "4321",
        bvn: null,
        balanceKobo: 500000,
        currency: "NGN",
        institution: "GTBank",
      });
    });
  });
});
