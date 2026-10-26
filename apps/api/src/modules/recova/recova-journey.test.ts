import { afterEach, describe, expect, it, vi } from "vitest";
import { RecovaJourneyService, JOURNEY_STEPS } from "./recova-journey.service";

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("Complete isolated customer journey", () => {
  it("uses real checkout/approval/repayment SQL, carries arrears and clears the loan without provider traffic", async () => {
    vi.stubEnv("RECOVA_SANDBOX_ENABLED", "true"); vi.stubEnv("NODE_ENV", "test");
    const external = vi.fn(() => { throw new Error("No external traffic is allowed in practice"); });
    vi.stubGlobal("fetch", external);
    const service = new RecovaJourneyService();
    try {
      expect(await service.status("tester")).toMatchObject({ started: false });
      await service.start("tester");
      const application = await service.advance("tester");
      expect(application).toMatchObject({ completedSteps: 1, application: { status: "submitted" } });
      const approved = await service.advance("tester");
      expect(approved).toMatchObject({ credit: { limitNaira: 100000, usedNaira: 0 } });
      for (let i = 2; i < 7; i++) await service.advance("tester");
      const firstCollection = await service.status("tester");
      expect(firstCollection).toMatchObject({ accounting: { repaymentCount: 1, ledgerBalanced: true } });
      expect("installments" in firstCollection && firstCollection.installments[0].isPaid).toBe(true);
      await service.advance("tester"); // missed second installment
      const maturity = await service.advance("tester");
      expect(maturity).toMatchObject({ policy: { stage: "recovery", recoveryTargetKobo: 4_153_334 }, accounting: { repaymentCount: 1 } });
      const partial = await service.advance("tester");
      expect(partial).toMatchObject({ policy: { recoveryTargetKobo: 3_153_334 } });
      const completed = await service.advance("tester", true);
      expect(completed).toMatchObject({ complete: true, completedSteps: JOURNEY_STEPS.length,
        order: { status: "delivered", totalNaira: 62300 }, credit: { usedNaira: 0 },
        policy: { stage: "closed", outstandingKobo: 0 }, accounting: { receivedNaira: 62300, ledgerBalanced: true }, providerTransactions: 0,
      });
      expect(completed.installments.every((r) => r.isPaid)).toBe(true);
      expect((await service.advance("tester", true)).accounting).toEqual(completed.accounting);
      expect(external).not.toHaveBeenCalled();
      expect(await service.status("another-staff-member")).toMatchObject({ started: false });
    } finally { await service.onModuleDestroy(); }
  }, 120_000);

  it("cannot start the practice database on production", async () => {
    vi.stubEnv("RECOVA_SANDBOX_ENABLED", "true"); vi.stubEnv("NODE_ENV", "production");
    await expect(new RecovaJourneyService().start("tester")).rejects.toThrow("local development API only");
  });
});
