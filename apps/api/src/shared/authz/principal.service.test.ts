import { UnauthorizedException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import type { FastifyRequest } from "fastify";
import { PrincipalService } from "./principal.service";
import type { AppConfig } from "../../config/app-config";

function configFor(nodeEnv: AppConfig["nodeEnv"]): AppConfig {
  return {
    nodeEnv,
    port: 3001,
    pdp: { baseUrl: "http://127.0.0.1:3592", timeoutMs: 500 },
    // Required since YT-0552. These suites do not touch it, but a config
    // object that can omit it would mean the type still permits the
    // fallback this ticket removed.
    databaseUrl: "postgres://yourtal_app:app_local_only@127.0.0.1:26432/yourtal",
    redisUrl: "redis://127.0.0.1:26379",
    ledger: {
      mode: "fake" as const,
      baseUrl: "http://127.0.0.1:26312",
      voucherBaseUrl: "http://127.0.0.1:26313",
    },
    teenAccounts: false,
