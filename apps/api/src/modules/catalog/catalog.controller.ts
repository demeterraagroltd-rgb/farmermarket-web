import { Controller, Get, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import { CurrentStaff, type AuthenticatedStaff } from "../../common/decorators/current-staff.decorator";

/**
 * Reference implementation of a role-gated route (Phase 0 done-criteria:
 * "a staff user logs in with MFA and hits a role-gated route"). Real
 * catalog CRUD (§10) lands in Phase 3 — this is the auth wiring proof.
 */
@ApiTags("catalog")
@ApiBearerAuth()
@Controller("admin/catalog")
@UseGuards(JwtAuthGuard, RolesGuard)
export class CatalogController {
  @Get("ping")
  @Roles("super_admin", "admin")
  ping(@CurrentStaff() staff: AuthenticatedStaff) {
    return { ok: true, staffId: staff.staffId, role: staff.role };
  }
}
