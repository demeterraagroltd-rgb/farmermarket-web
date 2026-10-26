import { Controller, Get, Header, Param, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { productionStatus } from "./recova-production.config";
import { requestProductionLookup } from "./recova.client";
import { consentSetupStatus } from "./recova-consent.config";

const reference = z.string().min(1).max(100).regex(/^[A-Za-z0-9._-]+$/, "Use a valid Recova loan reference.");

@ApiTags("recova-production")
@ApiBearerAuth()
@Controller("admin/recova/production")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("super_admin", "admin")
export class RecovaProductionController {
  @Get("status")
  @Header("Cache-Control", "no-store")
  status() { return { ...productionStatus(), customerSetup: consentSetupStatus() }; }

  @Get("mandate/:reference")
  @Header("Cache-Control", "no-store")
  mandate(@Param("reference", new ZodValidationPipe(reference)) ref: string) { return requestProductionLookup("mandate", ref); }

  @Get("consent/:reference")
  @Header("Cache-Control", "no-store")
  consent(@Param("reference", new ZodValidationPipe(reference)) ref: string) { return requestProductionLookup("consent", ref); }
}
