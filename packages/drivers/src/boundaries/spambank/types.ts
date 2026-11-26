import type { Result } from "neverthrow";
import type { BoundaryFailure } from "../../fault-engine";
import type { DriverMode } from "../../driver-mode";

/**
 * Talking to Stalwart (BUILD.md §4.3, §7). Two kinds of caller:
 *
 * - **Management**, with the service's API key: create and destroy accounts, app passwords, list
 *   domains (JMAP `x:` methods).
 * - **As an account**, with that account's derived password: JMAP for provisioning, ingest and the
 *   auto-reply, and raw HTTP for the proxy. The caller never sees or holds the password.
 */

/** Why a call failed, finer than `BoundaryFailure.kind`. */
export type SpambankFailureCode =
  /** Stalwart is down, slow or answered 5xx. Retry later; never a reason to fail a health check. */
  | "unavailable"
  /** Our credential was refused: a misconfigured key, or an account whose password was changed. */
  | "upstream_auth"
  | "already_exists"
  | "not_found"
  /** Stalwart understood and said no (a JMAP error type other than the above). */
  | "rejected"
  /** The simulated driver has no mail server behind it. */
  | "simulated";

export interface SpambankFailure extends BoundaryFailure {
  readonly code: SpambankFailureCode;
}

export type SpambankResult<T> = Result<T, SpambankFailure>;

export interface SpambankDomain {
  readonly id: string;
  readonly name: string;
}

export interface CreateAccountInput {
  readonly localPart: string;
  readonly domain: string;
  readonly quotaBytes: number;
}

export interface CreatedAccount {
  /** Stalwart's account id (`spambank.mailbox.stalwart_account_id`). */
  readonly accountId: string;
  /** The Basic/IMAP/SMTP login (see `loginFor`). */
  readonly login: string;
}

export interface AppPasswordSummary {
  readonly id: string;
  readonly name: string;
  readonly createdAt: string | null;
}

export interface CreatedAppPassword extends AppPasswordSummary {
  /** Shown once. `app_...`. */
  readonly secret: string;
}

/** A JMAP method call: `[name, arguments, callId]`. */
export type JmapMethodCall = readonly [
  name: string,
  args: Readonly<Record<string, unknown>>,
  callId: string,
];

export interface JmapRequest {
  /** Capability URNs; defaults to core + mail. */
  readonly using?: readonly string[];
  readonly methodCalls: readonly JmapMethodCall[];
}

export interface JmapResponse {
  /** `[name, result, callId]`, as Stalwart returned them. A method-level `error` is NOT turned into a failure. */
  readonly methodResponses: readonly (readonly [string, Record<string, unknown>, string])[];
  readonly sessionState?: string;
}

export interface UpstreamInit {
  readonly method?: "GET" | "POST" | "PUT" | "DELETE" | "HEAD";
  /** Only a safe subset is forwarded; `authorization`, `cookie`, `origin`, `host` and `x-forwarded-*` never are. */
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: string | Uint8Array | ReadableStream<Uint8Array>;
  /** Sent upstream as `X-Forwarded-For`, so Stalwart's auth-failure blocking hits the client, not loopback. */
  readonly clientIp?: string;
  /** Default 30 000. `0` means none: the caller supplies `signal` (uploads, EventSource). */
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
}

/** One mailbox's own connection to Stalwart. */
export interface SpambankAccountClient {
  readonly login: string;
  /** `POST /jmap/` as the account. */
  jmap(request: JmapRequest): Promise<SpambankResult<JmapResponse>>;
  /**
   * Any other request to Stalwart as the account, by path (`/jmap/session`, a download, an upload,
   * the EventSource). Only ever the configured Stalwart address: a path that resolves elsewhere is
   * refused. A 401 is `upstream_auth`, never passed on. `set-cookie` and `www-authenticate` are
   * dropped from the response.
   */
  fetch(path: string, init?: UpstreamInit): Promise<SpambankResult<Response>>;
}

export interface SpambankDriver {
  readonly mode: DriverMode;
  /** `x:Domain/get`: the domains Stalwart serves. The deploy's ping. */
  listDomains(): Promise<SpambankResult<readonly SpambankDomain[]>>;
  /** `already_exists` when the name is taken. */
  createAccount(input: CreateAccountInput): Promise<SpambankResult<CreatedAccount>>;
  /** Idempotent: an account that is already gone is a success. */
  destroyAccount(accountId: string): Promise<SpambankResult<void>>;
  createAppPassword(accountId: string, name: string): Promise<SpambankResult<CreatedAppPassword>>;
  listAppPasswords(accountId: string): Promise<SpambankResult<readonly AppPasswordSummary[]>>;
  /** Idempotent. */
  revokeAppPassword(accountId: string, appPasswordId: string): Promise<SpambankResult<void>>;
  /** The mailbox's own connection. */
  account(localPart: string, domain: string): SpambankAccountClient;
}
