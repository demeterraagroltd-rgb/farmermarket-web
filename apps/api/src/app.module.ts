import { Module } from "@nestjs/common";
import { DbModule } from "./db/db.module";
import { HealthModule } from "./modules/health/health.module";
import { AuthModule } from "./modules/auth/auth.module";
import { CatalogModule } from "./modules/catalog/catalog.module";

@Module({
  imports: [DbModule, HealthModule, AuthModule, CatalogModule],
})
export class AppModule {}
