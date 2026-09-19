import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter } from "@nestjs/platform-fastify";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { ZodValidationPipe } from "nestjs-zod";
import { AppModule } from "./app.module";
import { loadAppConfig } from "./config/app-config";

/**
 * NestJS on Fastify (docs/13b section 7, docs/15) — no Express middleware,
 * no `@types/express` anywhere in this tree. `ZodValidationPipe` is
 * registered exactly once, globally, so a new controller cannot forget it
 * (docs/13b section 3) — DTOs opt in by extending `createZodDto`.
 *
 * NOT exercised by this ticket's test suite: there is no live Cerbos sidecar
 * or Postgres to bind to in this environment, so this file is typechecked
 * but has not been run. See the ticket report.
 */
async function bootstrap(): Promise<void> {
  const config = loadAppConfig();
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), {
    // The idempotency fingerprint hashes the bytes the client actually
    // sent, not a re-serialisation of the parsed object — see
    // @yourtal/idempotency/fingerprint for why canonical JSON was avoided.
    rawBody: true,
  });
  app.useGlobalPipes(new ZodValidationPipe());
  await app.listen(config.port, "0.0.0.0");
}

bootstrap().catch((error: unknown) => {
  // A failed boot is unrecoverable (docs/13b section 4); no logger exists
  // this early, so this is the one legitimate direct console use in the app.
  console.error(error);
  process.exitCode = 1;
});
