import { ForbiddenException } from "@nestjs/common";
import type { ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { errAsync, okAsync } from "neverthrow";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PdpClient } from "@yourtal/authz/pdp-client";
import { PdpGuard } from "./pdp.guard";
import { AsyncPrincipalResolver } from "./async-principal-resolver";
import { PrincipalService } from "./principal.service";
import { AUTHORIZE_METADATA, PUBLIC_ROUTE_METADATA } from "./authorize.decorator";
import type { AppConfig } from "../../config/app-config";
import type { PrincipalSecurityStateRepository } from "../../modules/identity/persistence/principal-security-state.repository";

// No security-state rows in this suite — nothing here exercises the freeze,
// only that a principal reaches the PDP at all.
// async-principal-resolver.test.ts covers the freeze itself.
const NO_SECURITY_STATE: PrincipalSecurityStateRepository = {
  findByUserId: () => Promise.resolve(null),
};

/**
 * That a declared route is actually enforced. `authorized-routes.test.ts`
 * proves the declaration exists; this proves it does something, and that an
 * UNDECLARED route is refused rather than waved through.
 */

const CONFIG: AppConfig = {
  nodeEnv: "test",
  port: 3001,
  pdp: { baseUrl: "http://127.0.0.1:26592", timeoutMs: 500 },
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
