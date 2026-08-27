import { Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { CustomerJwtAuthGuard } from "../../common/guards/customer-jwt-auth.guard";
import { CurrentUser, type AuthenticatedUser } from "../../common/decorators/current-user.decorator";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { OrdersService } from "./orders.service";
import { CreateOrderDto, createOrderSchema } from "./dto/create-order.dto";

// Matches the routes OrdersRepository already calls (§14): GET /orders,
// GET /orders/:id, POST /orders — all scoped to the caller's own userId,
// never a client-supplied one.
@ApiTags("orders")
@ApiBearerAuth()
@Controller("orders")
@UseGuards(CustomerJwtAuthGuard)
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Get()
  findAll(@CurrentUser() user: AuthenticatedUser) {
    return this.ordersService.findAllForUser(user.userId);
  }

  @Get(":id")
  findOne(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.ordersService.findOneForUser(user.userId, id);
  }

  @Post()
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(createOrderSchema)) body: CreateOrderDto,
  ) {
    return this.ordersService.create(user.userId, body);
  }
}
