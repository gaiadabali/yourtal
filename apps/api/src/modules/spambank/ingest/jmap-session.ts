import type { JmapMethodCall, SpambankAccountClient } from "@yourtal/drivers/spambank";

/**
 * Talking JMAP as one mailbox: the helpers ingest and the attachment route share. A failure of Stalwart
 * itself (down, our credential refused) is a `JmapProblem` carrying the driver's code; a JMAP method's own
 * `error` result carries JMAP's error type (`cannotCalculateChanges`, ...).
 */
export class JmapProblem extends Error {
  constructor(
    readonly code: string,
    detail: string,
  ) {
    super(detail);
  }
}

export interface MethodResult {
  readonly name: string;
  readonly result: Record<string, unknown>;
}

const MAIL = "urn:ietf:params:jmap:mail";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** One JMAP request; throws `JmapProblem` for an HTTP-level failure. Method errors stay in the map. */
export async function call(
  client: SpambankAccountClient,
  calls: readonly JmapMethodCall[],
): Promise<Map<string, MethodResult>> {
  const response = await client.jmap({ methodCalls: calls });
  if (response.isErr()) throw new JmapProblem(response.error.code, response.error.detail);
  const byId = new Map<string, MethodResult>();
  for (const [name, result, callId] of response.value.methodResponses) {
    byId.set(callId, { name, result });
  }
  return byId;
}

/** The method's result; a method-level `error` becomes a `JmapProblem` carrying JMAP's error type. */
export function resultOf(
  responses: Map<string, MethodResult>,
  callId: string,
): Record<string, unknown> {
  const found = responses.get(callId);
  if (found === undefined) throw new JmapProblem("unavailable", `no answer for ${callId}`);
  if (found.name === "error") {
    const type = found.result["type"];
    throw new JmapProblem(typeof type === "string" ? type : "unknown", `JMAP error on ${callId}`);
  }
  return found.result;
}

export interface JmapSession {
  readonly accountId: string;
  /** The `downloadUrl` template, if the session has one. */
  readonly downloadUrl: string | null;
  /** The `uploadUrl` template, if the session has one. */
  readonly uploadUrl?: string | null;
}

/** The account's own JMAP session: its primary mail account id and the download URL template. */
export async function readSession(client: SpambankAccountClient): Promise<JmapSession> {
  const response = await client.fetch("/jmap/session");
  if (response.isErr()) throw new JmapProblem(response.error.code, response.error.detail);
  if (!response.value.ok) {
    await response.value.body?.cancel();
    throw new JmapProblem(
      "unavailable",
      `the JMAP session answered ${String(response.value.status)}`,
    );
  }
  let body: unknown;
  try {
    body = await response.value.json();
  } catch {
    throw new JmapProblem("unavailable", "the JMAP session was not JSON");
  }
  if (!isRecord(body)) throw new JmapProblem("unavailable", "the JMAP session was not an object");
  const primary = isRecord(body["primaryAccounts"]) ? body["primaryAccounts"][MAIL] : undefined;
  const accounts = isRecord(body["accounts"]) ? Object.keys(body["accounts"]) : [];
  const accountId = typeof primary === "string" ? primary : accounts[0];
  if (accountId === undefined)
    throw new JmapProblem("unavailable", "the JMAP session names no account");
  const template = body["downloadUrl"];
  const upload = body["uploadUrl"];
  return {
    accountId,
    downloadUrl: typeof template === "string" ? template : null,
    uploadUrl: typeof upload === "string" ? upload : null,
  };
}

const accountIds = new Map<string, string>();

/** The primary mail account id, cached for the life of the process (it never changes for a login). */
export async function jmapAccountId(client: SpambankAccountClient): Promise<string> {
  const cached = accountIds.get(client.login);
  if (cached !== undefined) return cached;
  const { accountId } = await readSession(client);
  accountIds.set(client.login, accountId);
  return accountId;
}

/**
 * The path (on Stalwart's own address) of a blob download, from the session's URL template when it has one
 * (the public host in it is dropped: the driver only ever calls Stalwart's loopback address).
 */
export function downloadPath(
  session: JmapSession,
  blobId: string,
  name: string,
  type: string,
): string {
  const fill = (template: string): string =>
    template
      .replace(/\{accountId\}/g, encodeURIComponent(session.accountId))
      .replace(/\{blobId\}/g, encodeURIComponent(blobId))
      .replace(/\{name\}/g, encodeURIComponent(name))
      .replace(/\{type\}/g, encodeURIComponent(type));
  const fallback = `/jmap/download/{accountId}/{blobId}/{name}?accept={type}`;
  for (const template of [session.downloadUrl, fallback]) {
    if (template === null) continue;
    try {
      const url = new URL(fill(template), "http://stalwart.invalid");
      return `${url.pathname}${url.search}`;
    } catch {
      continue;
    }
  }
  return fill(fallback);
}

/** The path (on Stalwart's own address) of a blob upload, from the session's URL template when it has one. */
export function uploadPath(session: JmapSession): string {
  const fill = (template: string): string =>
    template.replace(/\{accountId\}/g, encodeURIComponent(session.accountId));
  for (const template of [session.uploadUrl ?? null, "/jmap/upload/{accountId}/"]) {
    if (template === null) continue;
    try {
      const url = new URL(fill(template), "http://stalwart.invalid");
      return `${url.pathname}${url.search}`;
    } catch {
      continue;
    }
  }
  return fill("/jmap/upload/{accountId}/");
}
