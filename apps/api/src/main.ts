import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter } from "@nestjs/platform-fastify";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { ZodValidationPipe } from "nestjs-zod";
import { assertDriversConfiguredForBoot } from "@yourtal/drivers/driver-mode";
import { AppModule } from "./app.module";
import { loadAppConfig } from "./config/app-config";
import { TRUSTED_PROXIES } from "./shared/http/trusted-proxies";

/**
 * NestJS on Fastify (docs/13b section 7, docs/15) — no Express middleware,
 * no `@types/express` anywhere in this tree. `ZodValidationPipe` is
 * registered exactly once, globally, so a new controller cannot forget it
 * (docs/13b section 3) — DTOs opt in by extending `createZodDto`.
 *
 * This DOES boot and bind to a live Cerbos sidecar and Postgres — the
 * docker-compose stack in `docker-compose.yml` provides both on the 26xxx
 * loopback ports `env.schema.ts` defaults to. The claim that neither existed
 * in this environment was true only until they were provisioned; it is
 * false now and was left uncorrected, which is its own small lesson about
 * comments that record a snapshot instead of an invariant. `GET /api/health`
 * (`shared/health/health.controller.ts`) is what proves both are reachable
 * on any given boot, rather than a comment asserting it once.
 */
async function bootstrap(): Promise<void> {
  const config = loadAppConfig();
  // 2.3.b: refuses to start on APP_ENV=staging unless every external driver
  // (packages/drivers/src/boundary.ts) is simulated — before anything else
  // boots, same reasoning as the ordinary misconfiguration check it wraps
  // (packages/drivers/src/driver-mode.ts): a half-booted app is worse than
  // one that never started.
  assertDriversConfiguredForBoot(process.env, config.appEnv);
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    // 1.5.e: `trustProxy` — every real deployment of this app runs behind
    // Helios's nginx (docs/audit/2026-09-25/api-backend.md section 8), so
    // without it `request.ip` is the PROXY's address on every request, not
    // the caller's, and every per-IP limit (register, password-reset
    // request, the login source throttle) collapses into one shared
    // bucket for the whole site. `true` trusts the immediate hop, which is
    // exactly nginx on the same host/network — never a public-facing
    // multi-hop chain this app would need to pick apart.
    // 13.3.e: trust X-Forwarded-For only from a loopback hop (nginx, or the web
    // server forwarding its viewer's address). `true` took the leftmost entry a
    // client wrote itself, so any caller could choose its own IP.
    new FastifyAdapter({ trustProxy: TRUSTED_PROXIES }),
    {
      // The idempotency fingerprint hashes the bytes the client actually
      // sent, not a re-serialisation of the parsed object — see
      // @yourtal/idempotency/fingerprint for why canonical JSON was avoided.
      rawBody: true,
    },
  );
  app.useGlobalPipes(new ZodValidationPipe());
  await app.listen(config.port, config.host ?? "127.0.0.1");
}

bootstrap().catch((error: unknown) => {
  // A failed boot is unrecoverable (docs/13b section 4); no logger exists
  // this early, so this is the one legitimate direct console use in the app.
  console.error(error);
  process.exitCode = 1;
});
