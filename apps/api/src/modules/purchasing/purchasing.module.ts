import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { PurchasingController } from "./purchasing.controller";
import { PurchasingService } from "./purchasing.service";
import { PayablesService } from "./payables.service";
import { PayablesController } from "./payables.controller";
@Module({imports:[AuthModule],controllers:[PurchasingController,PayablesController],providers:[PurchasingService,PayablesService]})
export class PurchasingModule {}
