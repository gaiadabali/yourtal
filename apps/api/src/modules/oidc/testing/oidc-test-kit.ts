import { generateKeyPairSync, randomBytes } from "node:crypto";
import type { KeyObject } from "node:crypto";
import path from "node:path";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import Provider from "oidc-provider";
import type { Adapter, AdapterFactory, AdapterPayload, FindAccount } from "oidc-provider";
import { loadClients } from "../client-keys";
import { clientsFor } from "../clients";
import type { YourTalClient } from "../clients";
import { loadProviderKeys } from "../keys";
import { mountOidc } from "../mount-oidc";
import { OidcRuntime } from "../oidc-runtime";
import { providerConfiguration } from "../provider-config";

/** Test-only: what a provider needs, without Postgres. */
export const TEST_ISSUER = "http://127.0.0.1:26999/oidc";
export const TEST_WEB_ORIGIN = "http://localhost:3000";
export const CLIENT_KEYS_DIR = "/test/oidc/clients";

export interface TestClientKeys {
  readonly files: { exists: (file: string) => boolean; read: (file: string) => string };
  readonly webKey: KeyObject;
  readonly serverKey: KeyObject;
  readonly ftrSecret: string;
}

function publicJwks(key: KeyObject, kid: string): string {
  const jwk = key.export({ format: "jwk" });
  return JSON.stringify({ keys: [{ ...jwk, kid, alg: "RS256", use: "sig" }] });
}

/** Key pairs for the two private_key_jwt clients and a secret for FTR, as files in a fake directory. */
export function makeTestClientKeys(): TestClientKeys {
  const web = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const server = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const ftrSecret = randomBytes(32).toString("base64url");
  const contents = new Map<string, string>([
    [
      path.join(CLIENT_KEYS_DIR, "snapapp-staging-web.jwks.json"),
      publicJwks(web.publicKey, "web-1"),
    ],
    [
      path.join(CLIENT_KEYS_DIR, "snapapp-staging-server.jwks.json"),
      publicJwks(server.publicKey, "srv-1"),
    ],
    [path.join(CLIENT_KEYS_DIR, "ftr-staging-web.secret"), ftrSecret],
  ]);
  return {
    files: {
      exists: (file) => contents.has(file),
      read: (file) => contents.get(file) ?? "",
    },
    webKey: web.privateKey,
    serverKey: server.privateKey,
    ftrSecret,
  };
}

/** The library's storage contract, in memory, honouring expiry and consumption. */
export function memoryAdapterFactory(): AdapterFactory {
  const store = new Map<string, { payload: AdapterPayload; expiresAt: number | undefined }>();
  return (kind: string): Adapter => {
    const key = (id: string) => `${kind}:${id}`;
    const live = (id: string) => {
      const entry = store.get(key(id));
      if (entry === undefined) return undefined;
      if (entry.expiresAt !== undefined && entry.expiresAt <= Date.now()) return undefined;
      return entry.payload;
    };
    return {
      upsert: (id, payload, expiresIn) => {
        store.set(key(id), {
          payload,
          expiresAt: expiresIn === undefined ? undefined : Date.now() + expiresIn * 1000,
        });
        return Promise.resolve();
      },
      find: (id) => Promise.resolve(kind === "Client" ? undefined : live(id)),
      findByUid: (uid) =>
        Promise.resolve(
          [...store.entries()].find(
            ([stored, entry]) => stored.startsWith(`${kind}:`) && entry.payload.uid === uid,
          )?.[1].payload,
        ),
      findByUserCode: () => Promise.resolve(undefined),
      consume: (id) => {
        const entry = store.get(key(id));
        if (entry !== undefined) entry.payload = { ...entry.payload, consumed: Date.now() };
        return Promise.resolve();
      },
      destroy: (id) => {
        store.delete(key(id));
        return Promise.resolve();
      },
      revokeByGrantId: (grantId) => {
        for (const [stored, entry] of store) {
          if (entry.payload.grantId === grantId) store.delete(stored);
        }
        return Promise.resolve();
      },
    };
  };
}

export interface TestProvider {
  readonly provider: Provider;
  readonly fastify: FastifyInstance;
  readonly keys: TestClientKeys;
  readonly registered: readonly YourTalClient[];
}

export interface TestProviderOptions {
  readonly issuer?: string;
  readonly findAccount?: FindAccount;
  readonly pairwiseIdentifier?: (accountId: string, clientId: string) => Promise<string>;
}

/** A provider over the real registry and settings, mounted on a bare Fastify, with no database. */
export async function buildTestProvider(options: TestProviderOptions = {}): Promise<TestProvider> {
  const keys = makeTestClientKeys();
  const loaded = loadClients(clientsFor("dev"), CLIENT_KEYS_DIR, keys.files);
  const provider = new Provider(
    options.issuer ?? TEST_ISSUER,
    providerConfiguration({
      clients: loaded.metadata,
      keys: loadProviderKeys({ appEnv: "dev", jwksPath: "/test/oidc/none.json" }, () => undefined),
      webOrigin: TEST_WEB_ORIGIN,
      adapter: memoryAdapterFactory(),
      findAccount: options.findAccount ?? (() => undefined),
      pairwiseIdentifier:
        options.pairwiseIdentifier ??
        ((accountId, clientId) => Promise.resolve(`${clientId}:${accountId}`)),
    }),
  );
  provider.proxy = true;
  const fastify = Fastify();
  await mountOidc(fastify, new OidcRuntime(provider, loaded.registered, null, null));
  await fastify.ready();
  return { provider, fastify, keys, registered: loaded.registered };
}
