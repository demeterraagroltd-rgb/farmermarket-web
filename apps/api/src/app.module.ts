import { Module } from "@nestjs/common";
import { DbModule } from "./db/db.module";
import { HealthModule } from "./modules/health/health.module";
import { AuthModule } from "./modules/auth/auth.module";
import { CatalogModule } from "./modules/catalog/catalog.module";
import { ApplicationsModule } from "./modules/applications/applications.module";
import { StaffModule } from "./modules/staff/staff.module";
import { CustomersModule } from "./modules/customers/customers.module";
import { OrdersModule } from "./modules/orders/orders.module";
import { WalletModule } from "./modules/wallet/wallet.module";
import { KycModule } from "./modules/kyc/kyc.module";
import { NotificationsModule } from "./modules/notifications/notifications.module";

@Module({
  imports: [
    DbModule,
    NotificationsModule,
    HealthModule,
    AuthModule,
    CatalogModule,
    ApplicationsModule,
    StaffModule,
    CustomersModule,
    OrdersModule,
    WalletModule,
    KycModule,
  ],
})
export class AppModule {}
