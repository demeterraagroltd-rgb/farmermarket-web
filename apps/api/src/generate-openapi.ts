import "reflect-metadata";
import { writeFileSync } from "node:fs";
import { NestFactory } from "@nestjs/core";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { AppModule } from "./app.module";

// Writes packages/contracts/openapi.json without starting an HTTP listener —
// used by the codegen pipeline in packages/contracts/README.md.
async function main() {
  const app = await NestFactory.create(AppModule, { logger: false });
  const config = new DocumentBuilder().setTitle("Farmer Market API").setVersion("0.1.0").build();
  const document = SwaggerModule.createDocument(app, config);
  writeFileSync("../../packages/contracts/openapi.json", JSON.stringify(document, null, 2));
  await app.close();
}

main();
