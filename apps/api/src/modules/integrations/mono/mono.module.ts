import { Global, Logger, Module } from "@nestjs/common";
import { MONO_CLIENT } from "./mono.types";
import { HttpMonoClient } from "./http-mono.client";
import { FakeMonoClient } from "./fake-mono.client";

@Global()
@Module({
  providers: [
    {
      provide: MONO_CLIENT,
      useFactory: () => {
        const key = process.env.MONO_SECRET_KEY;
        if (!key) {
          new Logger("MonoModule").warn(
            "MONO_SECRET_KEY not set — bank linking uses the fake client (canned salary history).",
          );
          return new FakeMonoClient();
        }
        return new HttpMonoClient(key, process.env.MONO_BASE_URL);
      },
    },
  ],
  exports: [MONO_CLIENT],
})
export class MonoModule {}
