import "reflect-metadata";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { Test } from "@nestjs/testing";
import { Reflector } from "@nestjs/core";
import { UnauthorizedException, type ExecutionContext, type INestApplication } from "@nestjs/common";
import { DB } from "../../db/db.module";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { RecovaSandboxController } from "./recova.controller";
import { RecovaJourneyService } from "./recova-journey.service";
import { RecovaProductionController } from "./recova-production.controller";

describe("Recova staff HTTP boundary", () => {
  let app: INestApplication;
  let base: string;
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [RecovaSandboxController, RecovaProductionController],
      // Preview/status must not read or mutate the loan database.
      providers: [{ provide: RecovaJourneyService, useValue: {} }, { provide: DB, useValue: {
        select() { throw new Error("Unexpected database read"); },
        insert() { throw new Error("Unexpected database write"); },
        transaction() { throw new Error("Unexpected database transaction"); },
      } }],
    }).overrideGuard(JwtAuthGuard).useValue({
      canActivate(context: ExecutionContext) {
        const req = context.switchToHttp().getRequest();
        const role = req.headers.authorization === "Bearer test-admin" ? "admin"
          : req.headers.authorization === "Bearer test-credit" ? "credit" : null;
        if (!role) throw new UnauthorizedException();
        req.staff = { staffId: "test", role };
        return true;
      },
    }).overrideGuard(RolesGuard).useValue(new RolesGuard(new Reflector())).compile();
    app = module.createNestApplication({ logger: false });
    await app.listen(0, "127.0.0.1");
    base = `${await app.getUrl()}/admin/recova/sandbox`;
  }, 30_000);
  afterEach(() => vi.unstubAllEnvs());
  afterAll(async () => { await app?.close(); });

  it("requires a staff session and rejects credit-only users", async () => {
    expect((await fetch(`${base}/status`)).status).toBe(401);
    expect((await fetch(`${base}/status`, { headers: { Authorization: "Bearer test-credit" } })).status).toBe(403);
  });
  it("protects production lookups and exposes no production mutation routes", async () => {
    const production = base.replace("/sandbox", "/production");
    expect((await fetch(`${production}/status`)).status).toBe(401);
    expect((await fetch(`${production}/status`, { headers: { Authorization: "Bearer test-credit" } })).status).toBe(403);
    const status = await fetch(`${production}/status`, { headers: { Authorization: "Bearer test-admin" } });
    expect(status.status).toBe(200);
    expect(status.headers.get("cache-control")).toBe("no-store");
    expect((await fetch(`${production}/consent`, { method: "POST", headers: { Authorization: "Bearer test-admin" } })).status).toBe(404);
  });
  it("does not expose the provider token in status", async () => {
    vi.stubEnv("RECOVA_API_TOKEN", "provider-secret-never-return");
    const res = await fetch(`${base}/status`, { headers: { Authorization: "Bearer test-admin" } });
    const text = await res.text();
    expect(res.status).toBe(200);
    expect(text).toContain('"tokenConfigured":true');
    expect(text).not.toContain("provider-secret-never-return");
  });
  it("validates preview inputs at the HTTP boundary and returns actual policy results", async () => {
    const post = (body: unknown) => fetch(`${base}/preview`, {
      method: "POST", headers: { Authorization: "Bearer test-admin", "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    expect((await post({ installments: [], asOf: "bad date" })).status).toBe(400);
    const res = await post({ installments: [{ dueDate: "2027-01-21", amountKobo: 2_200_000, paidKobo: 1_000_000 }], asOf: "2027-01-22T00:00:00+01:00" });
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ stage: "recovery", recoveryTargetKobo: 1_200_000, executionEnabled: false });
  });
});
