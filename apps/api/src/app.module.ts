import { InventoryModule } from "./modules/inventory/inventory.module";
import { PurchasingModule } from "./modules/purchasing/purchasing.module";
import { Module } from "@nestjs/common";
import { DbModule } from "./db/db.module";
import { HealthModule } from "./modules/health/health.module";
import { AuthModule } from "./modules/auth/auth.module";
import { CatalogModule } from "./modules/catalog/catalog.module";
import { ApplicationsModule } from "./modules/applications/applications.module";
import { StaffModule } from "./modules/staff/staff.module";
import { CustomersModule } from "./modules/customers/customers.module";
import { OrdersModule } from "./modules/orders/orders.module";
import { PickupCentersModule } from "./modules/pickup-centers/pickup-centers.module";
import { WalletModule } from "./modules/wallet/wallet.module";
import { KycModule } from "./modules/kyc/kyc.module";
import { CollectionsModule } from "./modules/collections/collections.module";
import { ReportsModule } from "./modules/reports/reports.module";
import { NotificationsModule } from "./modules/notifications/notifications.module";
import { InboxModule } from "./modules/inbox/inbox.module";
import { LocationsModule } from "./modules/locations/locations.module";
import { DirectDebitModule } from "./modules/direct-debit/direct-debit.module";
import { MonoPaymentsModule } from "./modules/integrations/mono-payments/mono-payments.module";

@Module({
  imports: [
    DbModule,
    NotificationsModule,
    HealthModule,
    AuthModule,
    CatalogModule,
    InventoryModule,
    PurchasingModule,
    ApplicationsModule,
    StaffModule,
    CustomersModule,
    OrdersModule,
    PickupCentersModule,
    WalletModule,
    KycModule,
    CollectionsModule,
    ReportsModule,
    InboxModule,
    LocationsModule,
    MonoPaymentsModule,
    DirectDebitModule,
  ],
})
export class AppModule {}
