import { Body, Controller, Get, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import { CurrentStaff, type AuthenticatedStaff } from "../../common/decorators/current-staff.decorator";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { ApplicationsService } from "./applications.service";
import { DecideApplicationDto, decideApplicationSchema } from "./dto/decide-application.dto";
import { VerifyApplicationDto, verifyApplicationSchema } from "./dto/verify-application.dto";

// The other side of the product loop's step 1 (§2): what the dashboard
// queue reads, and where steps 2-3 (decide, activate) happen. Full review
// workspace (§11.4) — filters, SLA clock, evidence tabs — is still ahead;
// this is "the admin can see what came in and act on it."
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

  @Get(":id/events")
  getEvents(@Param("id") id: string) {
    return this.applicationsService.getEvents(id);
  }

  @Patch(":id/verification")
  setVerification(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(verifyApplicationSchema)) body: VerifyApplicationDto,
  ) {
    return this.applicationsService.setVerification(id, body);
  }

  @Post(":id/decisions")
  decide(
    @Param("id") id: string,
    // Scoped to this one parameter, not @UsePipes() at the method level —
    // that would run the same schema against @Param()/@CurrentStaff() too
    // and reject every request before it reaches the body at all.
    @Body(new ZodValidationPipe(decideApplicationSchema)) body: DecideApplicationDto,
    @CurrentStaff() staff: AuthenticatedStaff,
  ) {
    return this.applicationsService.decide(id, staff.staffId, body);
  }
}
