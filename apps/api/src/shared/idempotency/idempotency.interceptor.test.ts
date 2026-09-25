import { BadRequestException, ConflictException, HttpException } from "@nestjs/common";
import type { CallHandler, ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { firstValueFrom, of, throwError } from "rxjs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryIdempotencyStore } from "@yourtal/idempotency/in-memory-store";
import { IdempotencyInterceptor } from "./idempotency.interceptor";
import { IDEMPOTENT_METADATA } from "./idempotent.decorator";
import { ONBOARDING_RETENTION_MS } from "./retention";
import { AsyncPrincipalResolver } from "../authz/async-principal-resolver";
import { PrincipalService } from "./../authz/principal.service";
import type { AppConfig } from "../../config/app-config";
import type { PrincipalSecurityStateRepository } from "../../modules/identity/persistence/principal-security-state.repository";

// Every context in this suite carries a tenantId, so the principal fallback
// in `scopeFor` (and the database read behind it) is never reached.
const NO_SECURITY_STATE: PrincipalSecurityStateRepository = {
  findByUserId: () => Promise.resolve(null),
};

/**
 * The half `mutating-routes.test.ts` cannot cover: that the interceptor
 * actually replays, conflicts and releases. The route scan proves a route is
 * DECLARED idempotent; this proves the declaration does something.
 */

const CONFIG: AppConfig = {
  nodeEnv: "test",
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
