import "reflect-metadata";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { Test } from "@nestjs/testing";
import { Reflector } from "@nestjs/core";
import { UnauthorizedException, type ExecutionContext, type INestApplication } from "@nestjs/common";
import { RecovaReconciliationController } from "./recova-reconciliation.controller";
import { RecovaReconciliationService } from "./recova-reconciliation.service";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";

let app: INestApplication; let base: string;
const service = { overview: vi.fn().mockResolvedValue({ loans: [] }), detail: vi.fn(), report: vi.fn().mockResolvedValue({ ledgerChanged: false }), dismiss: vi.fn() };
beforeAll(async () => {
  const module = await Test.createTestingModule({ controllers: [RecovaReconciliationController], providers: [{ provide: RecovaReconciliationService, useValue: service }] })
    .overrideGuard(JwtAuthGuard).useValue({ canActivate(context: ExecutionContext) {
      const req = context.switchToHttp().getRequest(); const role = req.headers.authorization?.replace("Bearer ", "");
      if (!role) throw new UnauthorizedException(); req.staff = { staffId: "staff-fixture", role }; return true;
    } }).overrideGuard(RolesGuard).useValue(new RolesGuard(new Reflector())).compile();
  app = module.createNestApplication({ logger: false }); await app.listen(0, "127.0.0.1"); base = `${await app.getUrl()}/admin/recova/reconciliation`;
}, 30000);
afterAll(async () => app?.close());
it("requires authorized staff, disables caching and validates reports at the boundary", async () => {
  expect((await fetch(base)).status).toBe(401);
  for (const role of ["credit", "sales"]) {
    expect((await fetch(base, { headers: { Authorization: `Bearer ${role}` } })).status).toBe(403);
    expect((await fetch(`${base}/fm-live-692f38a6-0473-424b-b79d-5b14e561c03c/reports`, { method: "POST", headers: { Authorization: `Bearer ${role}` } })).status).toBe(403);
  }
  const headers = { Authorization: "Bearer admin", "Content-Type": "application/json" };
  expect((await fetch(base, { headers })).headers.get("cache-control")).toBe("no-store");
  const path = `${base}/fm-live-692f38a6-0473-424b-b79d-5b14e561c03c/reports`;
  expect((await fetch(path, { method: "POST", headers, body: JSON.stringify({ amountNaira: "22000" }) })).status).toBe(400);
  expect(service.report).not.toHaveBeenCalled();
  expect((await fetch(path, { method: "POST", headers, body: JSON.stringify({ channel: "voluntary", sourceName: "Test bank", transactionReference: "TEST-REF", amountNaira: "22000", observedAt: new Date().toISOString() }) })).status).toBe(201);
  expect(service.report).toHaveBeenCalledOnce();
});
