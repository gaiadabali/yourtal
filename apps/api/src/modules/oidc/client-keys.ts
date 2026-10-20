import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { ClientMetadata, JWK } from "oidc-provider";
import type { YourTalClient } from "./clients";

/**
 * Turns the registry (`clients.ts`) into the provider's client metadata, with
 * each client's credential read from the configured directory (docs/26 §1.9):
 * `<client_id>.jwks.json` (public keys) for `private_key_jwt`,
 * `<client_id>.secret` for `client_secret_basic`. A client whose file is
 * missing is not registered, so it can only ever fail closed.
 */
export interface LoadedClients {
  readonly metadata: ClientMetadata[];
  readonly registered: readonly YourTalClient[];
  /** Client ids left out, and the file each one needs. */
  readonly missing: readonly { readonly clientId: string; readonly file: string }[];
}

interface ClientFiles {
  readonly exists: (file: string) => boolean;
  readonly read: (file: string) => string;
}

const DISK: ClientFiles = { exists: existsSync, read: (file) => readFileSync(file, "utf8") };

/** Members only a private key has; a public JWKS that carries one is a key in the wrong place. */
const PRIVATE_MEMBERS = ["d", "p", "q", "dp", "dq", "qi", "k", "oth"];

export function credentialFileFor(client: YourTalClient, dir: string): string | undefined {
  if (client.auth === "private_key_jwt") return path.join(dir, `${client.clientId}.jwks.json`);
  if (client.auth === "client_secret_basic") return path.join(dir, `${client.clientId}.secret`);
  return undefined;
}

function publicJwks(raw: string, file: string): { keys: JWK[] } {
  const parsed: unknown = JSON.parse(raw);
  const keys =
    typeof parsed === "object" && parsed !== null && "keys" in parsed ? parsed.keys : undefined;
  if (!Array.isArray(keys) || keys.length === 0) throw new Error(`oidc: ${file} has no keys`);
  for (const key of keys) {
    if (typeof key !== "object" || key === null) throw new Error(`oidc: ${file} has a bad key`);
    if (PRIVATE_MEMBERS.some((member) => member in key)) {
      throw new Error(`oidc: ${file} holds private key material; it must hold public keys only`);
    }
  }
  return { keys: keys as JWK[] };
}

function clientSecret(raw: string, file: string): string {
  const secret = raw.trim();
  if (secret.length < 32)
    throw new Error(`oidc: ${file} must hold a secret of 32 characters or more`);
  return secret;
}

function metadataFor(client: YourTalClient): ClientMetadata {
  const base: ClientMetadata = {
    client_id: client.clientId,
    token_endpoint_auth_method: client.auth,
    subject_type: "pairwise",
    id_token_signed_response_alg: "RS256",
    scope: client.allowedScopes.join(" "),
  };
  if (client.kind === "machine") {
    return {
      ...base,
      redirect_uris: [],
      response_types: [],
      grant_types: ["client_credentials"],
      // The library needs a sector for a pairwise client without redirect URIs.
      // It is never fetched (sectorIdentifierUriValidate is off), and the sub's
      // real sector comes from the registry (pairwise.ts).
      sector_identifier_uri: `https://${client.sector}.sector.yourtal.invalid/`,
    };
  }
  return {
    ...base,
    application_type: client.kind,
    redirect_uris: [client.redirectUri],
    response_types: ["code"],
    response_modes: ["query"],
    grant_types: ["authorization_code"],
  };
}

export function loadClients(
  clients: readonly YourTalClient[],
  dir: string,
  files: ClientFiles = DISK,
): LoadedClients {
  const metadata: ClientMetadata[] = [];
  const registered: YourTalClient[] = [];
  const missing: { clientId: string; file: string }[] = [];

  for (const client of clients) {
    const file = credentialFileFor(client, dir);
    if (file !== undefined && !files.exists(file)) {
      missing.push({ clientId: client.clientId, file });
      continue;
    }
    const entry = metadataFor(client);
    if (file !== undefined && client.auth === "private_key_jwt") {
      entry.jwks = publicJwks(files.read(file), file);
    } else if (file !== undefined) {
      entry.client_secret = clientSecret(files.read(file), file);
    }
    metadata.push(entry);
    registered.push(client);
  }
  return { metadata, registered, missing };
}
