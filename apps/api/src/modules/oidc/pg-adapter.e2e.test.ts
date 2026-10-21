import { randomUUID } from "node:crypto";
import { errors } from "oidc-provider";
import pg from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { pgAdapterFactory } from "./pg-adapter";

/** The provider's storage over `oidc.model`, against Postgres. */
const pool = new pg.Pool({ connectionString: process.env["DATABASE_URL"], max: 4 });
const adapterFor = pgAdapterFactory(pool);

afterAll(async () => {
  await pool.end();
});

async function issuedCode(): Promise<{ code: string; grantId: string; tokenId: string }> {
  const code = randomUUID();
  const grantId = randomUUID();
  const tokenId = randomUUID();
  await adapterFor("Grant").upsert(grantId, { jti: grantId, accountId: "u" }, 60);
  await adapterFor("AuthorizationCode").upsert(code, { jti: code, grantId }, 60);
  await adapterFor("AccessToken").upsert(tokenId, { jti: tokenId, grantId }, 60);
  return { code, grantId, tokenId };
}

describe("the oidc.model adapter", () => {
  it("hides a row once it has expired", async () => {
    const id = randomUUID();
    await adapterFor("Interaction").upsert(id, { jti: id }, 60);
    expect(await adapterFor("Interaction").find(id)).toMatchObject({ jti: id });
    await pool.query(
      "UPDATE oidc.model SET expires_at = now() - interval '1 second' WHERE id = $1",
      [id],
    );
    expect(await adapterFor("Interaction").find(id)).toBeUndefined();
  });

  it("marks a consumed code, which is how the library spots a second use", async () => {
    const { code } = await issuedCode();
    await adapterFor("AuthorizationCode").consume(code);
    expect(await adapterFor("AuthorizationCode").find(code)).toHaveProperty("consumed");
  });

  it("lets only one of two racing redemptions consume a code; the other revokes the grant", async () => {
    const { code, grantId, tokenId } = await issuedCode();
    const adapter = adapterFor("AuthorizationCode");
    const results = await Promise.allSettled([adapter.consume(code), adapter.consume(code)]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((result) => result.status === "rejected");
    expect(rejected?.status === "rejected" && rejected.reason).toBeInstanceOf(errors.InvalidGrant);
    expect(await adapterFor("Grant").find(grantId)).toBeUndefined();
    expect(await adapterFor("AccessToken").find(tokenId)).toBeUndefined();
  });

  it("never stores or reads a client", async () => {
    await expect(
      adapterFor("Client").upsert("evil-app", { client_id: "evil-app" }, 60),
    ).rejects.toThrow();
    const planted = `planted-${randomUUID()}`;
    await pool.query("INSERT INTO oidc.model (kind, id, payload) VALUES ('Client', $1, '{}')", [
      planted,
    ]);
    expect(await adapterFor("Client").find(planted)).toBeUndefined();
  });
});
