import { randomUUID } from "node:crypto";
import { createPdpClient } from "@yourtal/authz/pdp-client";
import type { Resource } from "@yourtal/authz/resources";
import type { FastifyRequest } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { AsyncPrincipalResolver } from "./async-principal-resolver";
import { PrincipalService } from "./principal.service";
import type { AppConfig } from "../../config/app-config";
import { createAppDb } from "../persistence/drizzle-client";
import type { AppDb } from "../persistence/drizzle-client";
import { DrizzlePrincipalSecurityStateRepository } from "../../modules/identity/persistence/drizzle-principal-security-state.repository";
import { principalSecurityState } from "../../modules/identity/persistence/schema/principal-security-state.table";

/**
 * YT-0582, proved end to end at the boundary that actually exists.
 *
 * `wallet.yaml` has no controller yet — that is itself one of this
 * ticket's findings — so there is no HTTP route to drive. This is the
 * resolver-plus-PDP round trip instead: a real row in
 * `identity.principal_security_state`, read by a real
 * `AsyncPrincipalResolver`, decided by a real Cerbos sidecar. Run
 * `docker restart yourtal-cerbos` immediately before this suite — a
 * long-running sidecar can serve a cached schema and hand back a false
 * pass.
 */
const CONFIG: AppConfig = {
  nodeEnv: "test",
  port: 3001,
  pdp: { baseUrl: "http://127.0.0.1:26592", timeoutMs: 500 },
  // No literal fallback (YT-0571): `vitest.config.ts`'s `setupFiles` already
  // refuses to run this suite unless `DATABASE_URL` names a `yourtal_test_*`
  // database, so it is as safe a fallback here as `TEST_DATABASE_URL`.
  databaseUrl: process.env["TEST_DATABASE_URL"] ?? process.env["DATABASE_URL"]!,
  redisUrl: "redis://127.0.0.1:26379",
  ledger: {
    mode: "fake" as const,
    baseUrl: "http://127.0.0.1:26312",
    voucherBaseUrl: "http://127.0.0.1:26313",
  },
  teenAccounts: false,
