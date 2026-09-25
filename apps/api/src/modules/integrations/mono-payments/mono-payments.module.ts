import { Global, Logger, Module } from "@nestjs/common";
import { DIRECT_DEBIT_CLIENT } from "./direct-debit.types";
import { HttpDirectDebitClient } from "./http-direct-debit.client";
import { FakeDirectDebitClient } from "./fake-direct-debit.client";

// Direct debit is a separate Mono product from Connect, so its key is separate
// (MONO_PAYMENTS_SECRET_KEY); it falls back to MONO_SECRET_KEY for an account
// where one app carries both. With neither set, the fake is used and no money
// can move — see DirectDebitService for the guard that keeps a fake from ever
// "collecting" in production.
@Global()
@Module({
  providers: [
    {
      provide: DIRECT_DEBIT_CLIENT,
      useFactory: () => {
        const key = process.env.MONO_PAYMENTS_SECRET_KEY || process.env.MONO_SECRET_KEY;
        if (!key) {
          new Logger("MonoPaymentsModule").warn("No Mono payments key set — auto-debit uses the fake client (no money moves).");
          return new FakeDirectDebitClient();
        }
        return new HttpDirectDebitClient(key, process.env.MONO_BASE_URL);
      },
    },
  ],
  exports: [DIRECT_DEBIT_CLIENT],
})
export class MonoPaymentsModule {}
