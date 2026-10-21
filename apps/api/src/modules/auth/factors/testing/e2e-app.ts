import { randomBytes, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { FastifyAdapter } from "@nestjs/platform-fastify";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import type { LightMyRequestResponse } from "fastify";
import { AppModule } from "../../../../app.module";
import type { AppDb } from "../../../../shared/persistence/drizzle-client";
import type { TestSession } from "../../../../shared/testing/session-for";
import { AuthService } from "../../auth.service";
import { hashOpaqueToken } from "../../crypto/opaque-token";

/** The relying party the e2e app is booted with, and the soft authenticator answers for. */
export const E2E_RP_ID = "localhost";
export const E2E_ORIGIN = "http://localhost:3000";

/** Boots the real app with a known relying party; returns it and a restore function. */
export async function bootFactorsApp(): Promise<{
  app: NestFastifyApplication;
  close: () => Promise<void>;
}> {
  const saved = {
    rpId: process.env["WEBAUTHN_RP_ID"],
    origin: process.env["WEBAUTHN_ORIGIN"],
  };
  process.env["WEBAUTHN_RP_ID"] = E2E_RP_ID;
  process.env["WEBAUTHN_ORIGIN"] = E2E_ORIGIN;
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return {
    app,
    close: async () => {
      await app.close();
      if (saved.rpId === undefined) delete process.env["WEBAUTHN_RP_ID"];
      else process.env["WEBAUTHN_RP_ID"] = saved.rpId;
      if (saved.origin === undefined) delete process.env["WEBAUTHN_ORIGIN"];
      else process.env["WEBAUTHN_ORIGIN"] = saved.origin;
    },
  };
}

/** A private-use address per call, so per-IP limits never couple two tests. */
export function testIp(): string {
  const [a, b, c] = randomBytes(3);
  return `10.${String(a)}.${String(b)}.${String(c)}`;
}

/** The `amr` stored on the session a raw token names. */
export async function amrOf(owner: AppDb, token: string): Promise<string[] | undefined> {
  const { rows } = await owner.execute<{ amr: string[] }>(
    sql`SELECT amr FROM identity.session WHERE id = ${hashOpaqueToken(token)}`,
  );
  return rows[0]?.amr;
}

/** Pretends the person signed in an hour ago, so adding a sign-in method needs a fresh one. */
export async function ageSessions(owner: AppDb, userId: string): Promise<void> {
  await owner.execute(
    sql`UPDATE identity.session
        SET signed_in_at = date_trunc('milliseconds', now() - interval '1 hour')
        WHERE user_id = ${userId}`,
  );
}

/** When the session a raw token names says the person signed in. */
export async function signedInAtOf(owner: AppDb, token: string): Promise<Date | undefined> {
  const { rows } = await owner.execute<{ signed_in_at: Date }>(
    sql`SELECT signed_in_at FROM identity.session WHERE id = ${hashOpaqueToken(token)}`,
  );
  return rows[0]?.signed_in_at;
}

/** Subjects of the security notices sent to an address, oldest first. */
export async function securityNotices(owner: AppDb, email: string): Promise<string[]> {
  const { rows } = await owner.execute<{ subject: string; body: string }>(
    sql`SELECT subject, body FROM platform.sim_outbox
        WHERE recipient = ${email} AND category = 'security_notice' ORDER BY created_at`,
  );
  return rows.map((row) => `${row.subject}\n${row.body}`);
}

export function bearer(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

export function errorCode(response: LightMyRequestResponse): string | undefined {
  return response.json<{ code?: string }>().code;
}

/**
 * A signed-in adult, like `sessionFor`, but registered through `AuthService`
 * rather than `POST /api/auth/register`: that route's suite-wide hourly cap
 * is shared by every e2e file, and these suites need many fresh accounts.
 * The sign-in itself is the real `POST /api/auth/login`.
 */
export async function accountFor(
  app: NestFastifyApplication,
  password = "factors-e2e-not-a-real-secret-1",
): Promise<TestSession> {
  const email = `factors-e2e+${randomUUID()}@example.test`;
  const registered = await app.get(AuthService).register(
    email,
    password,
    {
      region: "AU",
      locale: "en-AU",
      displayName: "Factors E2E",
      dateOfBirth: "1990-01-01",
      timezone: "Australia/Sydney",
    },
    new Date(),
  );
  if (registered.isErr()) throw new Error(`accountFor: ${registered.error.type}`);
  const login = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    remoteAddress: testIp(),
    payload: { email, password },
  });
  const { token, userId } = login.json<{ token?: string; userId?: string }>();
  if (token === undefined || userId === undefined) throw new Error(`accountFor: ${login.body}`);
  return { userId, email, token, cookie: `yt_session=${token}` };
}
