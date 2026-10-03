import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { InventoryController } from "./inventory.controller";
import { InventoryService } from "./inventory.service";
import { WarehousesService } from './warehouses.service';
import { ValuationService } from './valuation.service';
import { ValuationController } from './valuation.controller';

@Module({ imports: [AuthModule], controllers: [InventoryController,ValuationController], providers: [InventoryService,WarehousesService,ValuationService] })
export class InventoryModule {}
