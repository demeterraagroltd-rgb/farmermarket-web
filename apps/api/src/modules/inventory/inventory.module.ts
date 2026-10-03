import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { InventoryController } from "./inventory.controller";
import { InventoryService } from "./inventory.service";
import { WarehousesService } from './warehouses.service';

@Module({ imports: [AuthModule], controllers: [InventoryController], providers: [InventoryService,WarehousesService] })
export class InventoryModule {}
