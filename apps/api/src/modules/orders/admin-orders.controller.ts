import { Body, Controller, Get, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import { CurrentStaff, type AuthenticatedStaff } from "../../common/decorators/current-staff.decorator";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { OrdersService } from "./orders.service";
import { OrderReviewService } from "./order-review.service";

const updateStatusSchema = z.object({
  status: z.enum(["preparing", "on_the_way", "delivered", "cancelled"]),
});

const approveSchema = z.object({
  deliverySlot: z.string().min(1).optional(), // e.g. "Tue 3 Sep, 9am–12pm"
});

const rejectSchema = z.object({
  reason: z.string().min(1),
});

// Staff-facing order operations. credit sees the pipeline read-only;
// admin/super_admin approve/reject and move orders through it (§11.4).
@ApiTags("orders")
@ApiBearerAuth()
@Controller("admin/orders")
@UseGuards(JwtAuthGuard, RolesGuard)
export class AdminOrdersController {
  constructor(
    private readonly ordersService: OrdersService,
    private readonly orderReviewService: OrderReviewService,
  ) {}

  @Get()
  @Roles("super_admin", "admin", "credit")
  findAll() {
    return this.ordersService.findAllForStaff();
  }

  // The Order Review / credit-underwriting workspace's single fetch —
  // applicant, KYC/BVN, Mono, existing credit position, and this order.
  @Get(":id/review")
  @Roles("super_admin", "admin", "credit")
  review(@Param("id") id: string, @CurrentStaff() staff: AuthenticatedStaff) {
    return this.orderReviewService.getReview(staff.staffId, id);
  }

  @Post(":id/approve")
  @Roles("super_admin", "admin")
  approve(
    @Param("id") id: string,
    @CurrentStaff() staff: AuthenticatedStaff,
    @Body(new ZodValidationPipe(approveSchema)) body: { deliverySlot?: string },
  ) {
    return this.ordersService.approve(id, staff.staffId, body.deliverySlot);
  }

  @Post(":id/reject")
  @Roles("super_admin", "admin")
  reject(
    @Param("id") id: string,
    @CurrentStaff() staff: AuthenticatedStaff,
    @Body(new ZodValidationPipe(rejectSchema)) body: { reason: string },
  ) {
    return this.ordersService.reject(id, staff.staffId, body.reason);
  }

  @Patch(":id/status")
  @Roles("super_admin", "admin")
  updateStatus(
    @Param("id") id: string,
    @CurrentStaff() staff: AuthenticatedStaff,
    @Body(new ZodValidationPipe(updateStatusSchema))
    body: { status: "preparing" | "on_the_way" | "delivered" | "cancelled" },
  ) {
    return this.ordersService.updateStatus(id, body.status, staff.staffId);
  }
}
