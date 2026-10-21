import { Logger } from "@nestjs/common";
import type { OnApplicationShutdown } from "@nestjs/common";
import Provider from "oidc-provider";
import type { Pool } from "pg";
import type { AppConfig } from "../../config/app-config";
import { createPool } from "../../shared/persistence/create-pool";
import { loadClients } from "./client-keys";
import type { YourTalClient } from "./clients";
import { clientsFor } from "./clients";
import { findAccountFrom } from "./find-account";
import { loadProviderKeys } from "./keys";
import type { OidcStore } from "./oidc-store";
import { createPgOidcStore } from "./oidc-store";
import { pairwiseIdentifierFor } from "./pairwise";
import { pgAdapterFactory } from "./pg-adapter";
import { providerConfiguration } from "./provider-config";
import { addProviderMiddleware } from "./provider-middleware";
import type { TeenInviteChecker } from "./sign-in-checks";

export const OIDC_RUNTIME = Symbol("OIDC_RUNTIME");

const logger = new Logger("Oidc");

/** The provider and what the interaction API needs beside it. All null while OIDC_ENABLED is off. */
export class OidcRuntime implements OnApplicationShutdown {
  constructor(
    readonly provider: Provider | null,
    readonly clients: readonly YourTalClient[],
    readonly store: OidcStore | null,
    private readonly pool: Pool | null,
  ) {}

  get enabled(): boolean {
    return this.provider !== null;
  }

  async onApplicationShutdown(): Promise<void> {
    await this.pool?.end();
  }
}

export function disabledOidcRuntime(): OidcRuntime {
  return new OidcRuntime(null, [], null, null);
}

/**
 * Builds the provider from configuration. Refuses to start on staging or
 * production without the key files; leaves out any client whose credential
 * file is missing, saying which.
 */
export function createOidcRuntime(
  config: AppConfig,
  teenInvites: TeenInviteChecker,
  pool?: Pool,
): OidcRuntime {
  const oidc = config.oidc;
  if (oidc?.enabled !== true) return disabledOidcRuntime();

  const keys = loadProviderKeys({ appEnv: config.appEnv, jwksPath: oidc.jwksPath }, (message) => {
    logger.warn(message);
  });
  const loaded = loadClients(clientsFor(config.appEnv, oidc.operators), oidc.clientKeysDir);
  for (const { clientId, file } of loaded.missing) {
    logger.warn(`client ${clientId} is not registered: ${file} is missing`);
  }

  const ownPool = pool === undefined ? createPool(config.databaseUrl, { max: 5 }) : null;
  const usePool = pool ?? ownPool;
  if (usePool === null) throw new Error("oidc: no database pool");
  const store = createPgOidcStore(usePool);

  const provider = new Provider(
    oidc.issuer,
    providerConfiguration({
      clients: loaded.metadata,
      keys,
      webOrigin: config.webOrigin,
      adapter: pgAdapterFactory(usePool),
      findAccount: findAccountFrom(store, () => loaded.registered, teenInvites),
      pairwiseIdentifier: pairwiseIdentifierFor(store, loaded.registered),
    }),
  );
  // Behind nginx: trust X-Forwarded-Proto for secure cookies and https URLs.
  provider.proxy = true;
  addProviderMiddleware(provider, store, (message) => {
    logger.error(message);
  });
  logger.log(`provider ready at ${oidc.issuer} with ${String(loaded.registered.length)} clients`);
  return new OidcRuntime(provider, loaded.registered, store, ownPool);
}
