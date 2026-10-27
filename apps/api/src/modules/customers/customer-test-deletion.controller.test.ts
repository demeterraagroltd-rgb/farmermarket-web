import "reflect-metadata";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { Test } from "@nestjs/testing";
import { Reflector } from "@nestjs/core";
import { UnauthorizedException, type ExecutionContext, type INestApplication } from "@nestjs/common";
import { CustomersController } from "./customers.controller";
import { CustomersService } from "./customers.service";
import { Customer360Service } from "./customer-360.service";
import { CustomerFinancialService } from "./customer-financial.service";
import { CustomerTestDeletionService } from "./customer-test-deletion.service";
import { KycService } from "../kyc/kyc.service";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";

let app: INestApplication; let base: string;
const remove = vi.fn().mockResolvedValue({ outcome: "test_data_purged" });
const preview = vi.fn().mockResolvedValue({ allowed: true });
beforeAll(async () => {
  const module = await Test.createTestingModule({ controllers: [CustomersController], providers: [
    ...[CustomersService, Customer360Service, CustomerFinancialService, KycService].map(provide => ({ provide, useValue: {} })),
    { provide: CustomerTestDeletionService, useValue: { remove, preview } },
  ] }).overrideGuard(JwtAuthGuard).useValue({ canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest();
    const role = req.headers.authorization?.replace("Bearer ", "");
    if (!["credit", "admin", "super_admin"].includes(role)) throw new UnauthorizedException();
    req.staff = { staffId: "test-staff", role }; return true;
  } }).overrideGuard(RolesGuard).useValue(new RolesGuard(new Reflector())).compile();
  app = module.createNestApplication({ logger: false }); await app.listen(0, "127.0.0.1");
  base = `${await app.getUrl()}/admin/customers/692f38a6-0473-424b-b79d-5b14e561c03c`;
}, 30000);
afterAll(async () => { await app?.close(); });
it("allows only super admins to preview or erase test accounts and validates destructive confirmation", async () => {
  for (const role of [null, "credit", "admin"]) {
    const headers: Record<string, string> = role ? { Authorization: `Bearer ${role}` } : {};
    expect((await fetch(`${base}/test-deletion-preview`, { headers })).status).toBe(role ? 403 : 401);
    expect((await fetch(`${base}/delete-test-account`, { method: "POST", headers })).status).toBe(role ? 403 : 401);
  }
  expect(remove).not.toHaveBeenCalled(); expect(preview).not.toHaveBeenCalled();
  const headers = { Authorization: "Bearer super_admin", "Content-Type": "application/json" };
  expect((await fetch(`${base}/test-deletion-preview`, { headers })).status).toBe(200);
  expect((await fetch(`${base}/delete-test-account`, { method: "POST", headers, body: "{}" })).status).toBe(400);
  expect(remove).not.toHaveBeenCalled();
  expect((await fetch(`${base}/delete-test-account`, { method: "POST", headers, body: JSON.stringify({ confirmation: "DELETE 692f38a6-0473-424b-b79d-5b14e561c03c", testDataConfirmed: true, reason: "Test reset" }) })).status).toBe(201);
  expect(remove).toHaveBeenCalledTimes(1);
});
