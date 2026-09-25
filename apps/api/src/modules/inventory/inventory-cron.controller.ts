import { Controller, Post, UseGuards } from "@nestjs/common";
import { ApiExcludeController } from "@nestjs/swagger";
import { CronSecretGuard } from "../../common/guards/cron-secret.guard";
import { InventoryService } from "./inventory.service";

// Machine-triggered, same shape as MonoCronController: GitHub Actions POSTs
// here daily with the shared `x-cron-secret` header
// (.github/workflows/inventory-sweep.yml).
@ApiExcludeController()
@Controller("inventory")
export class InventoryCronController {
  constructor(private readonly inventory: InventoryService) {}

  @Post("cron")
  @UseGuards(CronSecretGuard)
  cron() {
    return this.inventory.runDailySweep();
  }
}
