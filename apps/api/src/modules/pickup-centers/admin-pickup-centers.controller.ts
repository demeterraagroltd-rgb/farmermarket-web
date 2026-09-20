import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { PickupCentersService } from "./pickup-centers.service";
import {
  CreatePickupCenterDto,
  createPickupCenterSchema,
  UpdatePickupCenterDto,
  updatePickupCenterSchema,
} from "./dto/pickup-center.dto";

// Operations data, so the same two roles that manage the catalogue (§6.2) —
// credit and sales read orders but don't decide where goods are collected.
@ApiTags("pickup-centers")
@ApiBearerAuth()
@Controller("admin/pickup-centers")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("super_admin", "admin")
export class AdminPickupCentersController {
  constructor(private readonly service: PickupCentersService) {}

  @Get()
  list() {
    return this.service.listAll();
  }

  @Post()
  create(@Body(new ZodValidationPipe(createPickupCenterSchema)) body: CreatePickupCenterDto) {
    return this.service.create(body);
  }

  @Patch(":id")
  update(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updatePickupCenterSchema)) body: UpdatePickupCenterDto,
  ) {
    return this.service.update(id, body);
  }

  @Delete(":id")
  remove(@Param("id") id: string) {
    return this.service.remove(id);
  }
}
