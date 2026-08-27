import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { CatalogController } from "./catalog.controller";
import { AdminCatalogController } from "./admin-catalog.controller";
import { CatalogService } from "./catalog.service";

@Module({
  imports: [AuthModule], // for JwtService, used by JwtAuthGuard
  controllers: [CatalogController, AdminCatalogController],
  providers: [CatalogService],
})
export class CatalogModule {}
