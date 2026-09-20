import { Controller, Get } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { PickupCentersService } from "./pickup-centers.service";

// Public — no auth. The checkout page needs the list of collection points
// before it knows anything about the buyer, and the catalogue of centres is
// not sensitive.
@ApiTags("pickup-centers")
@Controller("pickup-centers")
export class PickupCentersController {
  constructor(private readonly service: PickupCentersService) {}

  // GET /v1/pickup-centers — active centres only; a deactivated one is still
  // on past orders but can't be chosen for a new one.
  @Get()
  listActive() {
    return this.service.listActive();
  }
}
