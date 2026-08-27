import { Body, Controller, Get, Param, Patch, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { OrdersService } from "./orders.service";

const updateStatusSchema = z.object({
  status: z.enum(["placed", "confirmed", "preparing", "on_the_way", "delivered", "cancelled"]),
});

// Staff-facing order operations. credit sees the pipeline read-only;
// admin/super_admin move orders through it (§11.4 orders section).
@ApiTags("orders")
@ApiBearerAuth()
@Controller("admin/orders")
@UseGuards(JwtAuthGuard, RolesGuard)
export class AdminOrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Get()
  @Roles("super_admin", "admin", "credit")
  findAll() {
    return this.ordersService.findAllForStaff();
  }

  @Patch(":id/status")
  @Roles("super_admin", "admin")
  updateStatus(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateStatusSchema))
    body: { status: "placed" | "confirmed" | "preparing" | "on_the_way" | "delivered" | "cancelled" },
  ) {
    return this.ordersService.updateStatus(id, body.status);
  }
}
