import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { PurchasingController } from "./purchasing.controller";
import { PurchasingService } from "./purchasing.service";
@Module({imports:[AuthModule],controllers:[PurchasingController],providers:[PurchasingService]})
export class PurchasingModule {}
