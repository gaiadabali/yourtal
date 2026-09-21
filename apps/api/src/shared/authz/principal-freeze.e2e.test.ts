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
  databaseUrl:
    process.env["TEST_DATABASE_URL"] ??
    "postgres://yourtal_app:app_local_only@127.0.0.1:26432/yourtal",
  redisUrl: "redis://127.0.0.1:26379",
};

const db: AppDb = createAppDb(CONFIG.databaseUrl);
const securityState = new DrizzlePrincipalSecurityStateRepository(db);
const principals = new AsyncPrincipalResolver(new PrincipalService(CONFIG), securityState);
const pdp = createPdpClient({ baseUrl: CONFIG.pdp.baseUrl });

function requestFor(userId: string): FastifyRequest {
  return { headers: { "x-yt-user-id": userId } } as unknown as FastifyRequest;
}

function walletOf(ownerId: string): Resource<"wallet"> {
  return { kind: "wallet", id: `wallet-${ownerId}`, attr: { ownerId } };
}

// A private table this ticket introduced; nothing else in the repo writes
// to it, so clearing it between tests is safe rather than destructive.
afterEach(async () => {
  await db.delete(principalSecurityState);
});

describe("the account freeze, proved end to end (YT-0582)", () => {
  it("a principal with NO freeze on file may redeem and transfer from their own wallet", async () => {
    const userId = `freeze-e2e-unfrozen-${randomUUID()}`;
    const principal = await principals.resolve(requestFor(userId));
    expect(principal.attr.valueFrozenUntil).toBeUndefined();

    const redeem = await pdp.requireAction(principal, walletOf(userId), "redeem");
    const transfer = await pdp.requireAction(principal, walletOf(userId), "transfer");

    expect(redeem.isOk()).toBe(true);
    expect(transfer.isOk()).toBe(true);
  });

  it("a principal frozen in the DATABASE is denied redeem and transfer", async () => {
    const userId = `freeze-e2e-frozen-${randomUUID()}`;
    await db
      .insert(principalSecurityState)
      .values({ userId, valueFrozenUntil: new Date(Date.now() + 60 * 60 * 1000) });

    const principal = await principals.resolve(requestFor(userId));
    expect(principal.attr.valueFrozenUntil).toBeDefined();

    const redeem = await pdp.requireAction(principal, walletOf(userId), "redeem");
    const transfer = await pdp.requireAction(principal, walletOf(userId), "transfer");

    expect(redeem.isErr()).toBe(true);
    expect(redeem._unsafeUnwrapErr()).toMatchObject({ type: "forbidden", action: "redeem" });
    expect(transfer.isErr()).toBe(true);
    expect(transfer._unsafeUnwrapErr()).toMatchObject({ type: "forbidden", action: "transfer" });
  });

  it("a freeze that has already EXPIRED is not a freeze — the timestamp is read, not merely stored", async () => {
    const userId = `freeze-e2e-expired-${randomUUID()}`;
    await db
      .insert(principalSecurityState)
      .values({ userId, valueFrozenUntil: new Date(Date.now() - 60 * 60 * 1000) });

    const principal = await principals.resolve(requestFor(userId));
    const redeem = await pdp.requireAction(principal, walletOf(userId), "redeem");

    expect(redeem.isOk()).toBe(true);
  });

  it("the freeze blocks spend, not reading the wallet", async () => {
    const userId = `freeze-e2e-view-${randomUUID()}`;
    await db
      .insert(principalSecurityState)
      .values({ userId, valueFrozenUntil: new Date(Date.now() + 60 * 60 * 1000) });

    const principal = await principals.resolve(requestFor(userId));
    const view = await pdp.requireAction(principal, walletOf(userId), "view");

    expect(view.isOk()).toBe(true);
  });
});
