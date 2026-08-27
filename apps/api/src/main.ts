import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { AppModule } from "./app.module";

// Money is bigint kobo throughout the schema (§5, §16), but JSON.stringify
// can't serialize a raw BigInt — every response with a money field would
// otherwise crash. Serializing as a string avoids precision loss too.
(BigInt.prototype as unknown as { toJSON: () => string }).toJSON = function (this: bigint) {
  return this.toString();
};

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix("v1", { exclude: ["health"] });

  // The web app and API are different origins (Vercel vs Render), so the
  // browser needs an explicit allow-list here — NestJS sends no
  // Access-Control-Allow-Origin header by default.
  const allowedOrigins = (process.env.CORS_ORIGINS ?? "http://localhost:3000")
    .split(",")
    .map((origin) => origin.trim());
  app.enableCors({ origin: allowedOrigins, credentials: true });

  // Feeds packages/contracts' codegen pipeline (§5.6).
  const config = new DocumentBuilder()
    .setTitle("Farmer Market API")
    .setVersion("0.1.0")
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup("docs", app, document);

  const port = process.env.PORT ? Number(process.env.PORT) : 3001;
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`API listening on :${port} (docs at /docs)`);
}

bootstrap();
