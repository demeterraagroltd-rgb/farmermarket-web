import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import { CurrentStaff, type AuthenticatedStaff } from "../../common/decorators/current-staff.decorator";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { InventoryService } from "./inventory.service";
import {
  AdjustStockDto,
  adjustStockSchema,
  ReceiveStockDto,
  receiveStockSchema,
  UpdateThresholdDto,
  updateThresholdSchema,
} from "./dto/inventory.dto";

// Stock is kept by head office only — the same super_admin + admin pair that
// owns the catalog (§6.2). Credit and sales get nothing here.
@ApiTags("inventory")
@ApiBearerAuth()
@Controller("admin/inventory")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("super_admin", "admin")
export class AdminInventoryController {
  constructor(private readonly inventory: InventoryService) {}

  @Get()
  list() {
    return this.inventory.listStock();
  }

  @Get("movements")
  movements(@Query("limit") limit?: string) {
    return this.inventory.listMovements({ limit: limit ? Number(limit) || 200 : 200 });
  }

  @Get("products/:id")
  product(@Param("id", ParseUUIDPipe) id: string) {
    return this.inventory.getProductStock(id);
  }

  @Patch("products/:id/threshold")
  threshold(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateThresholdSchema)) body: UpdateThresholdDto,
  ) {
    return this.inventory.updateThreshold(id, body.lowStockThreshold);
  }

  @Post("receive")
  receive(
    @Body(new ZodValidationPipe(receiveStockSchema)) body: ReceiveStockDto,
    @CurrentStaff() staff: AuthenticatedStaff,
  ) {
    return this.inventory.receive(body, staff.staffId);
  }

  @Post("adjust")
  adjust(
    @Body(new ZodValidationPipe(adjustStockSchema)) body: AdjustStockDto,
    @CurrentStaff() staff: AuthenticatedStaff,
  ) {
    return this.inventory.adjust(body, staff.staffId);
  }

  @Get("orders/:id/pick-list")
  pickList(@Param("id", ParseUUIDPipe) id: string) {
    return this.inventory.pickList(id);
  }
}
