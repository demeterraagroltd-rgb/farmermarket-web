import { Controller, Get } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { STATES_AND_LGAS } from "@farmermarket/core";

// Public — no auth. Consumed by the registration/KYC forms, which need the
// State → LGA cascade before an account exists.
//
// Static reference data served from the API rather than bundled into the web
// app so that both frontends (and later the Flutter app, §14) read one list.
// A dropdown that ships its own copy is how "Abuja" and "AMAC" end up in the
// same column six months later.
@ApiTags("config")
@Controller("config")
export class LocationsController {
  // GET /v1/config/locations — 37 states, 774 LGAs. ~20 KB, immutable, so
  // cache it hard; the dataset only changes if Nigeria changes.
  @Get("locations")
  listLocations() {
    return { states: STATES_AND_LGAS };
  }
}
