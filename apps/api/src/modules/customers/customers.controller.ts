import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, UseGuards } from "@nestjs/common";
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
import { DeactivateCustomerDto, deactivateCustomerSchema } from "./dto/deactivate-customer.dto";

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
