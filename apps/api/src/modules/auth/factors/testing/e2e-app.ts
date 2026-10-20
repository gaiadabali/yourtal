import { randomBytes } from "node:crypto";
import { sql } from "drizzle-orm";
import { FastifyAdapter } from "@nestjs/platform-fastify";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import type { LightMyRequestResponse } from "fastify";
import { AppModule } from "../../../../app.module";
import type { AppDb } from "../../../../shared/persistence/drizzle-client";
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
    sql`UPDATE identity.session SET created_at = now() - interval '1 hour' WHERE user_id = ${userId}`,
  );
}

export function bearer(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

export function errorCode(response: LightMyRequestResponse): string | undefined {
  return response.json<{ code?: string }>().code;
}
