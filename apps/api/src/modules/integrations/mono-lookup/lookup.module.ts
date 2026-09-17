import { Global, Logger, Module } from "@nestjs/common";
import { LOOKUP_CLIENT } from "./lookup.types";
import { HttpLookupClient } from "./http-lookup.client";
import { FakeLookupClient } from "./fake-lookup.client";

@Global()
@Module({
  providers: [
    {
      provide: LOOKUP_CLIENT,
      useFactory: () => {
        // Deliberately no fall back to MONO_SECRET_KEY. Lookup is a separate
        // product and is provisioned separately: borrowing the Connect key
        // for it buys a confusing 403 from Mono instead of the honest "not
        // configured ⇒ fake" every other integration here gives you. A
        // single-app Mono setup puts the same value in both slots.
        const key = process.env.MONO_LOOKUP_SECRET_KEY;
        if (!key) {
          new Logger("LookupModule").warn(
            "MONO_LOOKUP_SECRET_KEY not set — identity verification uses the fake client (canned BVN/NIN record).",
          );
          return new FakeLookupClient();
        }
        return new HttpLookupClient(key, process.env.MONO_BASE_URL);
      },
    },
  ],
  exports: [LOOKUP_CLIENT],
})
export class LookupModule {}
