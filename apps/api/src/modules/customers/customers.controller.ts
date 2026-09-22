import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query, Res, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import { CurrentStaff, type AuthenticatedStaff } from "../../common/decorators/current-staff.decorator";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { KycService } from "../kyc/kyc.service";
import { staffProfileEditSchema, type StaffProfileEditInput } from "../kyc/dto/kyc.dto";
import { CustomersService } from "./customers.service";
import { Customer360Service } from "./customer-360.service";
import { CustomerFinancialService } from "./customer-financial.service";
import {
  incomeSourcesQuerySchema,
  rawListQuerySchema,
  statementQuerySchema,
  transactionFilterSchema,
  transactionListSchema,
  type IncomeSourcesQueryInput,
  type RawListQueryInput,
  type StatementQueryInput,
  type TransactionFilterInput,
  type TransactionListInput,
} from "./dto/financial.dto";
import { DeactivateCustomerDto, deactivateCustomerSchema } from "./dto/deactivate-customer.dto";

// The one thing this controller needs from the HTTP response. Declared here
// rather than importing express's type, which this package doesn't depend on.
interface HeaderSink {
  setHeader(name: string, value: string): void;
}

// Sensitive financial and identity data: `sales` is deliberately not in the
// controller default, so it gets a 403 from every route below (RolesGuard
// denies by default, §13). Anything that changes a customer or spends a Mono
// call narrows this further at the method.
@ApiTags("customers")
@ApiBearerAuth()
@Controller("admin/customers")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("super_admin", "admin", "credit")
export class CustomersController {
  constructor(
    private readonly customersService: CustomersService,
    private readonly customer360: Customer360Service,
    private readonly kyc: KycService,
    private readonly financial: CustomerFinancialService,
  ) {}

  @Get()
  findAll() {
    return this.customersService.findAll();
  }

  // The Customer 360 read. Never calls Mono — everything comes from stored data.
  @Get(":id")
  detail(@Param("id", new ParseUUIDPipe()) id: string, @CurrentStaff() staff: AuthenticatedStaff) {
    return this.customer360.getDetail(staff.staffId, id);
  }

  // ── Stored bank data ────────────────────────────────────────────────────
  // Everything below reads what a sync already stored. None of it reaches Mono.

  @Get(":id/transactions")
  transactions(
    @Param("id", new ParseUUIDPipe()) id: string,
    @Query(new ZodValidationPipe(transactionListSchema)) query: TransactionListInput,
  ) {
    return this.financial.listTransactions(id, query);
  }

  // Taking data out of the system as a file is narrower than reading it on
  // screen. Declared before ":id/transactions/:txId" so "export.csv" is never
  // mistaken for a transaction id.
  @Get(":id/transactions/export.csv")
  @Roles("super_admin", "admin")
  async exportTransactions(
    @Param("id", new ParseUUIDPipe()) id: string,
    @CurrentStaff() staff: AuthenticatedStaff,
    @Query(new ZodValidationPipe(transactionFilterSchema)) query: TransactionFilterInput,
    @Res({ passthrough: true }) res: HeaderSink,
  ) {
    const out = await this.financial.exportTransactionsCsv(id, query, staff.staffId);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="transactions-${id.slice(0, 8)}.csv"`);
    res.setHeader("X-Export-Rows", String(out.rows));
    res.setHeader("X-Export-Truncated", String(out.truncated));
    return out.csv;
  }

  @Get(":id/transactions/:txId")
  transaction(
    @Param("id", new ParseUUIDPipe()) id: string,
    @Param("txId", new ParseUUIDPipe()) txId: string,
    @CurrentStaff() staff: AuthenticatedStaff,
  ) {
    return this.financial.getTransaction(id, txId, staff.staffId, staff.role);
  }

  @Get(":id/statement")
  statement(
    @Param("id", new ParseUUIDPipe()) id: string,
    @Query(new ZodValidationPipe(statementQuerySchema)) query: StatementQueryInput,
  ) {
    return this.financial.statement(id, query);
  }

  @Get(":id/income-sources")
  incomeSources(
    @Param("id", new ParseUUIDPipe()) id: string,
    @Query(new ZodValidationPipe(incomeSourcesQuerySchema)) query: IncomeSourcesQueryInput,
  ) {
    return this.financial.incomeSources(id, query);
  }

  // Mono's original responses — customer data in its rawest form, so admin and
  // super_admin only, and every open is audited.
  @Get(":id/mono-raw")
  @Roles("super_admin", "admin")
  rawResponses(
    @Param("id", new ParseUUIDPipe()) id: string,
    @Query(new ZodValidationPipe(rawListQuerySchema)) query: RawListQueryInput,
  ) {
    return this.financial.listRawResponses(id, query.limit);
  }

  @Get(":id/mono-raw/:rawId")
  @Roles("super_admin", "admin")
  rawResponse(
    @Param("id", new ParseUUIDPipe()) id: string,
    @Param("rawId", new ParseUUIDPipe()) rawId: string,
    @CurrentStaff() staff: AuthenticatedStaff,
  ) {
    return this.financial.getRawResponse(id, rawId, staff.staffId);
  }

  // Correcting a customer's declared application facts (employment, address,
  // household). Never identity fields — see staffProfileEditSchema.
  @Patch(":id/profile")
  @Roles("super_admin", "admin")
  editProfile(
    @Param("id", new ParseUUIDPipe()) id: string,
    @CurrentStaff() staff: AuthenticatedStaff,
    @Body(new ZodValidationPipe(staffProfileEditSchema)) body: StaffProfileEditInput,
  ) {
    return this.kyc.updateProfileAsStaff(staff.staffId, id, body);
  }

  // The one route that reaches Mono from this page. An explicit admin action,
  // never triggered by loading a customer.
  @Post(":id/refresh-bank-data")
  refreshBankData(@Param("id", new ParseUUIDPipe()) id: string, @CurrentStaff() staff: AuthenticatedStaff) {
    return this.kyc.refreshBankDataForStaff(staff.staffId, id);
  }

  // Suspend is reversible and never deletes. Removing a customer is a heavier
  // call than viewing the list — tightened to super_admin/admin, matching the
  // staff-management bar (§6.2). The method-level @Roles() overrides the
  // controller default in RolesGuard.
  @Post(":id/suspend")
  @Roles("super_admin", "admin")
  suspend(
    @Param("id", new ParseUUIDPipe()) id: string,
    @CurrentStaff() staff: AuthenticatedStaff,
    @Body(new ZodValidationPipe(deactivateCustomerSchema)) body: DeactivateCustomerDto,
  ) {
    return this.customersService.suspend(id, staff.staffId, body.reason);
  }

  @Delete(":id")
  @Roles("super_admin", "admin")
  remove(
    @Param("id", new ParseUUIDPipe()) id: string,
    @CurrentStaff() staff: AuthenticatedStaff,
    @Body(new ZodValidationPipe(deactivateCustomerSchema)) body: DeactivateCustomerDto,
  ) {
    return this.customersService.remove(id, staff.staffId, body.reason);
  }

  @Post(":id/reactivate")
  @Roles("super_admin", "admin")
  reactivate(
    @Param("id", new ParseUUIDPipe()) id: string,
    @CurrentStaff() staff: AuthenticatedStaff,
  ) {
    return this.customersService.reactivate(id, staff.staffId);
  }
}
