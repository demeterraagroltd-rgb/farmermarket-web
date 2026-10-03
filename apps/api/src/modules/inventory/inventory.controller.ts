import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import { CurrentStaff, type AuthenticatedStaff } from "../../common/decorators/current-staff.decorator";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { InventoryService } from "./inventory.service";
import { WarehousesService } from './warehouses.service';
import { allocationSchema, transferSchema, countSchema, type AllocationInput, type TransferInput, type CountInput } from './inventory.dto';
import { z } from 'zod';
const warehouseHistoryQuery=z.object({warehouseId:z.string().uuid().optional(),page:z.coerce.number().int().min(1).max(100000).default(1)});
import { historyQuerySchema, stockMovementSchema, thresholdSchema, type StockMovementInput } from "./inventory.dto";

@ApiTags("inventory")
@ApiBearerAuth()
@Controller("admin/inventory")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("super_admin", "admin")
export class InventoryController {
  constructor(private readonly inventory: InventoryService, private readonly warehouses:WarehousesService) {}
  @Get('warehouses') warehouseOverview(){return this.warehouses.overview();}
  @Get('warehouse-movements') warehouseHistory(@Query(new ZodValidationPipe(warehouseHistoryQuery)) query:{warehouseId?:string;page:number}){return this.warehouses.history(query.warehouseId,query.page);}
  @Post('allocations') allocate(@Body(new ZodValidationPipe(allocationSchema)) input:AllocationInput,@CurrentStaff() actor:AuthenticatedStaff){return this.warehouses.post('allocation',input,actor.staffId);}
  @Post('transfers') transfer(@Body(new ZodValidationPipe(transferSchema)) input:TransferInput,@CurrentStaff() actor:AuthenticatedStaff){return this.warehouses.post('transfer',input,actor.staffId);}
  @Post('counts') count(@Body(new ZodValidationPipe(countSchema)) input:CountInput,@CurrentStaff() actor:AuthenticatedStaff){return this.warehouses.post('count',input,actor.staffId);}
  @Post('legacy-orders/:id/warehouse') assignOrder(@Param('id',ParseUUIDPipe) id:string,@Body(new ZodValidationPipe(z.object({warehouseId:z.string().uuid()}))) input:{warehouseId:string},@CurrentStaff() actor:AuthenticatedStaff){return this.warehouses.assignLegacyOrder(id,input.warehouseId,actor.staffId);}
  @Get() overview() { return this.inventory.overview(); }
  @Get("movements") history(@Query(new ZodValidationPipe(historyQuerySchema)) query: { productId?: string; page: number }) { return this.inventory.history(query.productId, query.page); }
  @Post("products/:id/movements") move(@Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(stockMovementSchema)) body: StockMovementInput, @CurrentStaff() actor: AuthenticatedStaff) {
    return this.inventory.move(id, body, actor.staffId);
  }
  @Patch("products/:id/threshold") threshold(@Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(thresholdSchema)) body: { lowStockThreshold: number }, @CurrentStaff() actor: AuthenticatedStaff) {
    return this.inventory.threshold(id, body.lowStockThreshold, actor.staffId);
  }
}
