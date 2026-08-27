import { Controller, Get, Param, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import { ApplicationsService } from "./applications.service";

// The other side of the product loop's step 1 (§2): what the dashboard
// queue reads. Full review workspace (§11.4) — filters, SLA clock, decision
// panel — is still ahead; this is "the admin can see what came in."
@ApiTags("applications")
@ApiBearerAuth()
@Controller("admin/applications")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("super_admin", "admin", "credit")
export class AdminApplicationsController {
  constructor(private readonly applicationsService: ApplicationsService) {}

  @Get()
  findAll() {
    return this.applicationsService.findAll();
  }

  @Get(":id")
  findOne(@Param("id") id: string) {
    return this.applicationsService.findOne(id);
  }
}
