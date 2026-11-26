import { err, ok } from "neverthrow";
import type { Result } from "neverthrow";
import type { SpambankAccountClient, SpambankFailure } from "@yourtal/drivers/spambank";
import {
  ALLOWED_JMAP_CAPABILITIES,
  SPAMBANK_JMAP_PREFIX,
  withoutTrailingSlashes,
} from "@yourtal/contracts/spambank/mail";

/**
 * The mailbox's JMAP session on Stalwart (RFC 8620 §2), read as the account and kept for a few
 * minutes. The proxy needs it twice over: its URL templates say where Stalwart's api, upload,
 * download and EventSource live (only their paths are used: the host Stalwart names is its public
 * one, and the proxy only ever calls the loopback base, BUILD.md §4.3), and its primary account is
 * the one account id a token may name.
 */

const MAIL = "urn:ietf:params:jmap:mail";
const CACHE_MS = 5 * 60_000;
const CACHE_MAX = 5_000;
const ALLOWED: ReadonlySet<string> = new Set(ALLOWED_JMAP_CAPABILITIES);

export interface UpstreamSession {
  /** The account's own id, the only one a request may name. */
  readonly accountId: string;
  readonly apiUrl: string;
  readonly downloadUrl: string;
  readonly uploadUrl: string;
  readonly eventSourceUrl: string;
  /** The session object as Stalwart sent it, for the rewrite. */
  readonly raw: Record<string, unknown>;
}

export type SessionFailure =
  | { readonly kind: "driver"; readonly failure: SpambankFailure }
  | { readonly kind: "status"; readonly status: number }
  | { readonly kind: "malformed" };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

export function parseUpstreamSession(json: unknown): UpstreamSession | undefined {
  if (!isRecord(json)) return undefined;
  const primary = isRecord(json.primaryAccounts) ? text(json.primaryAccounts[MAIL]) : undefined;
  const apiUrl = text(json.apiUrl);
  const downloadUrl = text(json.downloadUrl);
  const uploadUrl = text(json.uploadUrl);
  const eventSourceUrl = text(json.eventSourceUrl);
  if (primary === undefined || !apiUrl || !downloadUrl || !uploadUrl || !eventSourceUrl) {
    return undefined;
  }
  return { accountId: primary, apiUrl, downloadUrl, uploadUrl, eventSourceUrl, raw: json };
}

/** RFC 6570 simple expansion, each value percent-encoded (what JMAP clients do). */
export function expandTemplate(template: string, values: Readonly<Record<string, string>>): string {
  return template.replace(/\{([A-Za-z0-9_]+)\}/g, (_m, name: string) =>
    encodeURIComponent(values[name] ?? ""),
  );
}

/**
 * The path and query of an expanded upstream URL; its scheme and host are dropped because the driver
 * resolves the path against the loopback base itself.
 */
export function upstreamPath(expanded: string): string | undefined {
  try {
    const url = new URL(expanded, "http://upstream.invalid");
    return `${url.pathname}${url.search}`;
  } catch {
    return undefined;
  }
}

function keepAllowed(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([key]) => ALLOWED.has(key)));
}

/**
 * The session a client sees (BUILD.md §5.3): the proxy's own URLs, only the §4.3 capabilities, and
 * only the mailbox's own account.
 */
export function rewriteSession(
  session: UpstreamSession,
  publicOrigin: string,
): Record<string, unknown> {
  const base = `${withoutTrailingSlashes(publicOrigin)}${SPAMBANK_JMAP_PREFIX}`;
  const raw = session.raw;
  const accounts = isRecord(raw.accounts) ? raw.accounts : {};
  const own = accounts[session.accountId];
  const account = isRecord(own)
    ? { ...own, accountCapabilities: keepAllowed(own.accountCapabilities) }
    : { name: "", isPersonal: true, isReadOnly: false, accountCapabilities: {} };
  const primaryAccounts = Object.fromEntries(
    Object.keys(keepAllowed(raw.primaryAccounts)).map((key) => [key, session.accountId]),
  );
  return {
    capabilities: keepAllowed(raw.capabilities),
    accounts: { [session.accountId]: account },
    primaryAccounts,
    username: typeof raw.username === "string" ? raw.username : "",
    apiUrl: `${base}/api`,
    downloadUrl: `${base}/download/{accountId}/{blobId}/{name}?accept={type}`,
    uploadUrl: `${base}/upload/{accountId}/`,
    eventSourceUrl: `${base}/eventsource?types={types}&closeafter={closeafter}&ping={ping}`,
    state: typeof raw.state === "string" ? raw.state : "",
  };
}

export interface UpstreamSessions {
  /** `clientIp` goes to Stalwart as `X-Forwarded-For` when the session has to be fetched. */
  get(
    mailboxId: string,
    account: SpambankAccountClient,
    clientIp?: string,
  ): Promise<Result<UpstreamSession, SessionFailure>>;
  forget(mailboxId: string): void;
}

export function createUpstreamSessions(now: () => number = Date.now): UpstreamSessions {
  const cache = new Map<string, { session: UpstreamSession; until: number }>();
  return {
    forget: (id) => {
      cache.delete(id);
    },
    async get(mailboxId, account, clientIp) {
      const hit = cache.get(mailboxId);
      if (hit !== undefined && hit.until > now()) return ok(hit.session);
      const response = await account.fetch("/jmap/session", {
        headers: { accept: "application/json" },
        ...(clientIp === undefined ? {} : { clientIp }),
      });
      if (response.isErr()) return err({ kind: "driver", failure: response.error });
      const res = response.value;
      if (res.status !== 200) {
        await res.body?.cancel();
        return err({ kind: "status", status: res.status });
      }
      let json: unknown;
      try {
        json = await res.json();
      } catch {
        return err({ kind: "malformed" });
      }
      const session = parseUpstreamSession(json);
      if (session === undefined) return err({ kind: "malformed" });
      if (cache.size >= CACHE_MAX) cache.clear();
      cache.set(mailboxId, { session, until: now() + CACHE_MS });
      return ok(session);
    },
  };
}
