import { Body, Controller, Get, Post, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { StaffService } from "./staff.service";
import { CreateStaffDto, createStaffSchema } from "./dto/create-staff.dto";

// "Staff CRUD & role assignment" is super_admin-only per the permission
// matrix (§6.2) — every other role gets a hard no here, not a filtered view.
@ApiTags("staff")
@ApiBearerAuth()
@Controller("admin/staff")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("super_admin")
export class StaffController {
  constructor(private readonly staffService: StaffService) {}

  @Get()
  findAll() {
    return this.staffService.findAll();
  }

  @Post()
  create(@Body(new ZodValidationPipe(createStaffSchema)) body: CreateStaffDto) {
    return this.staffService.create(body);
  }
}
