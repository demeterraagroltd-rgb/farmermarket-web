import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import { CurrentStaff, type AuthenticatedStaff } from "../../common/decorators/current-staff.decorator";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { CustomersService } from "./customers.service";
import { DeactivateCustomerDto, deactivateCustomerSchema } from "./dto/deactivate-customer.dto";

@ApiTags("customers")
@ApiBearerAuth()
@Controller("admin/customers")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("super_admin", "admin", "credit")
export class CustomersController {
  constructor(private readonly customersService: CustomersService) {}

  @Get()
  findAll() {
    return this.customersService.findAll();
  }

  // Removing a customer is a heavier call than viewing the list — tighten
  // it to super_admin/admin, matching the staff-management bar (§6.2). The
  // method-level @Roles() overrides the controller default in RolesGuard.
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
