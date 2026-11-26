import { isIP } from "node:net";
import { err, ok } from "neverthrow";
import { derivePassword, loginFor } from "./credentials";
import { refused, timedOut, unavailable } from "./failures";
import type {
  AppPasswordSummary,
  CreateAccountInput,
  JmapRequest,
  JmapResponse,
  SpambankAccountClient,
  SpambankDomain,
  SpambankDriver,
  SpambankFailure,
  SpambankResult,
  UpstreamInit,
} from "./types";

/**
 * The live Stalwart driver (BUILD.md §4.3, §7, STALWART-NOTES.md). Stalwart's HTTP port is loopback
 * only, so this is the one place that speaks to it.
 *
 * Several JMAP shapes below come from STALWART-NOTES.md and are [UNVERIFIED] until T0 records live
 * fixtures (`spambank/stalwart-fixtures/`): the `x:AppPassword` fields, whether the API key is a
 * Bearer token, and the exact error types. They are parsed tolerantly and kept in this one file.
 */

const CORE = "urn:ietf:params:jmap:core";
const MAIL = "urn:ietf:params:jmap:mail";
const STALWART = "urn:stalwart:jmap";
const DEFAULT_TIMEOUT_MS = 15_000;
const UPSTREAM_TIMEOUT_MS = 30_000;

/** Request headers a caller may pass through to Stalwart. Everything else is ours to set. */
const FORWARDED_REQUEST_HEADERS = new Set([
  "accept",
  "content-type",
  "range",
  "if-range",
  "if-none-match",
  "if-modified-since",
  "last-event-id",
  "cache-control",
]);
/** Response headers that must never reach a browser from Stalwart. */
const DROPPED_RESPONSE_HEADERS = ["set-cookie", "www-authenticate"];

export interface LiveSpambankOptions {
  /** Stalwart's address, e.g. `http://127.0.0.1:18080`. Origin only. */
  readonly baseUrl: string;
  /**
   * The management key. A `user:secret` value is sent as HTTP Basic (the recovery admin form), anything
   * else as `Bearer` (an `API_...` key; U8 settles which is right).
   */
  readonly apiKey: string;
  readonly credentialKey: string;
  readonly fetch?: typeof fetch;
  readonly timeoutMs?: number;
}

export function liveOptionsFromEnv(
  env: Readonly<Record<string, string | undefined>>,
): LiveSpambankOptions {
  const baseUrl = env.SPAMBANK_STALWART_URL?.trim() ?? "";
  const apiKey = env.SPAMBANK_STALWART_API_KEY?.trim() ?? "";
  const credentialKey = env.SPAMBANK_CREDENTIAL_KEY?.trim() ?? "";
  return { baseUrl, apiKey, credentialKey };
}

function originOf(baseUrl: string): string {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new Error("SPAMBANK_STALWART_URL is not a URL.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("SPAMBANK_STALWART_URL must be http or https.");
  }
  if (url.pathname !== "/" || url.search !== "" || url.username !== "" || url.password !== "") {
    throw new Error(
      "SPAMBANK_STALWART_URL must be an address only: no path, query or credentials.",
    );
  }
  return url.origin;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isMethodResponse(value: unknown): value is [string, Record<string, unknown>, string] {
  return (
    Array.isArray(value) &&
    value.length === 3 &&
    typeof value[0] === "string" &&
    isRecord(value[1]) &&
    typeof value[2] === "string"
  );
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

/** Maps a JMAP error `type` onto our codes. */
function failureForType(type: string, description?: string): SpambankFailure {
  const detail = description === undefined ? type : `${type}: ${description}`;
  switch (type) {
    case "forbidden":
    case "unauthorized":
      return refused("upstream_auth", detail);
    case "notFound":
      return refused("not_found", detail);
    case "alreadyExists":
      return refused("already_exists", detail);
    case "serverFail":
    case "serverUnavailable":
    case "serverPartialFail":
      return unavailable(detail);
    default:
      return refused("rejected", detail);
  }
}

export function createLiveSpambank(options: LiveSpambankOptions): SpambankDriver {
  const origin = originOf(options.baseUrl);
  const { credentialKey } = options;
  if (options.apiKey === "") throw new Error("SPAMBANK_STALWART_API_KEY is empty.");
  if (credentialKey.length < 32) {
    throw new Error("SPAMBANK_CREDENTIAL_KEY must be at least 32 characters.");
  }
  const doFetch = options.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const managementAuth = options.apiKey.includes(":")
    ? `Basic ${Buffer.from(options.apiKey).toString("base64")}`
    : `Bearer ${options.apiKey}`;
  let domainIds: Map<string, string> | undefined;

  /** One `POST /jmap/`. HTTP-level trouble becomes a failure; a method-level `error` is left to the caller. */
  async function postJmap(
    authorization: string,
    request: JmapRequest,
    defaultUsing: readonly string[],
  ): Promise<SpambankResult<JmapResponse>> {
    let response: Response;
    try {
      response = await doFetch(`${origin}/jmap/`, {
        method: "POST",
        headers: {
          authorization,
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify({
          using: request.using ?? defaultUsing,
          methodCalls: request.methodCalls,
        }),
        redirect: "error",
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      return err(
        error instanceof Error && error.name === "TimeoutError"
          ? timedOut()
          : unavailable("The request to Stalwart failed."),
      );
    }
    if (response.status === 401 || response.status === 403) {
      await response.body?.cancel();
      return err(refused("upstream_auth", `Stalwart answered ${String(response.status)}.`));
    }
    if (response.status >= 500 || response.status === 429) {
      await response.body?.cancel();
      return err(unavailable(`Stalwart answered ${String(response.status)}.`));
    }
    if (!response.ok) {
      await response.body?.cancel();
      return err(refused("rejected", `Stalwart answered ${String(response.status)}.`));
    }
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      return err(unavailable("Stalwart's answer was not JSON."));
    }
    if (!isRecord(body) || !Array.isArray(body.methodResponses)) {
      return err(unavailable("Stalwart's answer was not a JMAP response."));
    }
    const methodResponses = body.methodResponses.filter(isMethodResponse);
    if (methodResponses.length !== body.methodResponses.length) {
      return err(unavailable("Stalwart's answer had a malformed method response."));
    }
    const sessionState = str(body.sessionState);
    return ok({ methodResponses, ...(sessionState === undefined ? {} : { sessionState }) });
  }

  /** A management call of one method, returning that method's result or its error as a failure. */
  async function manage(
    method: string,
    args: Record<string, unknown>,
  ): Promise<SpambankResult<Record<string, unknown>>> {
    const result = await postJmap(managementAuth, { methodCalls: [[method, args, "c1"]] }, [
      CORE,
      STALWART,
    ]);
    if (result.isErr()) return err(result.error);
    const found = result.value.methodResponses.find(([, , callId]) => callId === "c1");
    if (found === undefined) return err(unavailable(`${method} had no response.`));
    const [name, value] = found;
    if (name === "error") {
      return err(failureForType(str(value.type) ?? "unknown", str(value.description)));
    }
    return ok(value);
  }

  /** `notCreated`/`notUpdated`/`notDestroyed` entry for `key`, as a failure; undefined when absent. */
  function setError(
    result: Record<string, unknown>,
    field: string,
    key: string,
  ): SpambankFailure | undefined {
    const map = result[field];
    if (!isRecord(map)) return undefined;
    const entry = map[key];
    if (!isRecord(entry)) return undefined;
    return failureForType(str(entry.type) ?? "unknown", str(entry.description));
  }

  async function domains(): Promise<SpambankResult<readonly SpambankDomain[]>> {
    const result = await manage("x:Domain/get", { ids: null });
    if (result.isErr()) return err(result.error);
    const list = result.value.list;
    if (!Array.isArray(list)) return err(unavailable("x:Domain/get had no list."));
    const found: SpambankDomain[] = [];
    for (const entry of list) {
      if (!isRecord(entry)) continue;
      const id = str(entry.id);
      const name = str(entry.name);
      if (id !== undefined && name !== undefined) found.push({ id, name });
    }
    domainIds = new Map(found.map((domain) => [domain.name.toLowerCase(), domain.id]));
    return ok(found);
  }

  async function domainId(name: string): Promise<SpambankResult<string>> {
    const key = name.toLowerCase();
    const cached = domainIds?.get(key);
    if (cached !== undefined) return ok(cached);
    const fresh = await domains();
    if (fresh.isErr()) return err(fresh.error);
    const id = domainIds?.get(key);
    return id === undefined
      ? err(refused("not_found", `Stalwart does not serve ${name}.`))
      : ok(id);
  }

  function accountClient(localPart: string, domain: string): SpambankAccountClient {
    const login = loginFor(localPart, domain);
    const authorization = `Basic ${Buffer.from(`${login}:${derivePassword(credentialKey, login)}`).toString("base64")}`;
    return {
      login,
      jmap: (request) => postJmap(authorization, request, [CORE, MAIL]),
      async fetch(path: string, init: UpstreamInit = {}): Promise<SpambankResult<Response>> {
        const url = resolveUpstream(origin, path);
        if (url === undefined) return err(refused("rejected", "Not a path on Stalwart."));
        const headers = new Headers();
        for (const [name, value] of Object.entries(init.headers ?? {})) {
          if (FORWARDED_REQUEST_HEADERS.has(name.toLowerCase())) headers.set(name, value);
        }
        headers.set("authorization", authorization);
        if (init.clientIp !== undefined && isIP(init.clientIp) !== 0) {
          headers.set("x-forwarded-for", init.clientIp);
        }
        const limit = init.timeoutMs ?? UPSTREAM_TIMEOUT_MS;
        const signals = [
          ...(limit > 0 ? [AbortSignal.timeout(limit)] : []),
          ...(init.signal === undefined ? [] : [init.signal]),
        ];
        const request: RequestInit & { duplex?: "half" } = {
          method: init.method ?? "GET",
          headers,
          redirect: "manual",
          ...(init.body === undefined ? {} : { body: init.body }),
          ...(init.body instanceof ReadableStream ? { duplex: "half" as const } : {}),
          ...(signals.length === 0 ? {} : { signal: AbortSignal.any(signals) }),
        };
        let response: Response;
        try {
          response = await doFetch(url, request);
        } catch (error) {
          return err(
            error instanceof Error && error.name === "TimeoutError"
              ? timedOut()
              : unavailable("The request to Stalwart failed."),
          );
        }
        if (response.status === 401) {
          await response.body?.cancel();
          return err(refused("upstream_auth", "Stalwart refused the account's credential."));
        }
        const cleaned = new Headers(response.headers);
        for (const name of DROPPED_RESPONSE_HEADERS) cleaned.delete(name);
        return ok(
          new Response(response.body, {
            status: response.status,
            statusText: response.statusText,
            headers: cleaned,
          }),
        );
      },
    };
  }

  return {
    mode: "live",

    listDomains: domains,

    async createAccount(input: CreateAccountInput) {
      const id = await domainId(input.domain);
      if (id.isErr()) return err(id.error);
      const login = loginFor(input.localPart, input.domain);
      const result = await manage("x:Account/set", {
        create: {
          a: {
            "@type": "User",
            name: input.localPart,
            domainId: id.value,
            credentials: {
              "0": { "@type": "Password", secret: derivePassword(credentialKey, login) },
            },
            roles: { "@type": "User" },
            permissions: { "@type": "Inherit" },
            quotas: { maxDiskQuota: input.quotaBytes },
          },
        },
      });
      if (result.isErr()) return err(result.error);
      const failure = setError(result.value, "notCreated", "a");
      if (failure !== undefined) return err(failure);
      const created = result.value.created;
      const accountId = isRecord(created) && isRecord(created.a) ? str(created.a.id) : undefined;
      if (accountId === undefined) return err(unavailable("x:Account/set returned no account id."));
      return ok({ accountId, login });
    },

    async destroyAccount(accountId: string) {
      const result = await manage("x:Account/set", { destroy: [accountId] });
      if (result.isErr()) return err(result.error);
      const failure = setError(result.value, "notDestroyed", accountId);
      // Already gone is what the caller wanted.
      if (failure !== undefined && failure.code !== "not_found") return err(failure);
      return ok(undefined);
    },

    async createAppPassword(accountId: string, name: string) {
      const result = await manage("x:AppPassword/set", {
        accountId,
        create: { a: { name } },
      });
      if (result.isErr()) return err(result.error);
      const failure = setError(result.value, "notCreated", "a");
      if (failure !== undefined) return err(failure);
      const created = result.value.created;
      const entry = isRecord(created) && isRecord(created.a) ? created.a : undefined;
      const id = entry === undefined ? undefined : str(entry.id);
      const secret = entry === undefined ? undefined : str(entry.secret);
      if (entry === undefined || id === undefined || secret === undefined) {
        return err(unavailable("x:AppPassword/set returned no id or secret."));
      }
      return ok({ id, name, createdAt: str(entry.createdAt) ?? null, secret });
    },

    async listAppPasswords(accountId: string) {
      const result = await manage("x:AppPassword/get", { accountId, ids: null });
      if (result.isErr()) return err(result.error);
      const list = result.value.list;
      if (!Array.isArray(list)) return err(unavailable("x:AppPassword/get had no list."));
      const items: AppPasswordSummary[] = [];
      for (const entry of list) {
        if (!isRecord(entry)) continue;
        const id = str(entry.id);
        if (id === undefined) continue;
        items.push({
          id,
          name: str(entry.name) ?? str(entry.description) ?? "",
          createdAt: str(entry.createdAt) ?? null,
        });
      }
      return ok(items);
    },

    async revokeAppPassword(accountId: string, appPasswordId: string) {
      const result = await manage("x:AppPassword/set", { accountId, destroy: [appPasswordId] });
      if (result.isErr()) return err(result.error);
      const failure = setError(result.value, "notDestroyed", appPasswordId);
      if (failure !== undefined && failure.code !== "not_found") return err(failure);
      return ok(undefined);
    },

    account: accountClient,
  };
}

/**
 * `path` resolved against Stalwart's origin, or undefined when it would leave it (a scheme, `//host`,
 * a backslash, control characters or spaces).
 */
export function resolveUpstream(origin: string, path: string): string | undefined {
  // eslint-disable-next-line no-control-regex -- refusing control characters is the point
  if (!path.startsWith("/") || path.startsWith("//") || /[\\\s\u0000-\u001f\u007f]/.test(path)) {
    return undefined;
  }
  let url: URL;
  try {
    url = new URL(path, `${origin}/`);
  } catch {
    return undefined;
  }
  return url.origin === origin ? url.toString() : undefined;
}
