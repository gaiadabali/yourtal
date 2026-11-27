import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { err, ok } from "neverthrow";
import type {
  JmapRequest,
  JmapResponse,
  SpambankAccountClient,
  SpambankDriver,
  SpambankFailure,
  SpambankResult,
} from "@yourtal/drivers/spambank";
import { parseOwnDomains } from "../classify/domains";
import { newsletter } from "../classify/fixtures/sender-fixtures";
import type { ClassifyConfig } from "../classify/sender-checks";
import type { MailboxRow } from "./db";
import { MAILBOX_COLUMNS } from "./db";

/**
 * Shared by the ingest tests: a pool on the test database, mailbox and consent rows keyed by a run token (so
 * files never collide), raw JMAP emails, and a scripted Stalwart. Not shipped: only tests import it.
 */

const URL = process.env["TEST_DATABASE_URL"] ?? process.env["DATABASE_URL"];

export function testPool(): Pool {
  if (URL === undefined) throw new Error("TEST_DATABASE_URL or DATABASE_URL must be set");
  return new Pool({ connectionString: URL, max: 8 });
}

export const RUN = Date.now().toString(36);
let counter = 0;

/** Letters only, 6-16: a valid generated local part, unique per call and run. */
export function localPart(): string {
  counter += 1;
  const letters = (text: string): string =>
    text.replace(/[0-9]/g, (digit) => "abcdefghij"[Number(digit)] ?? "a");
  return `tt${letters(RUN)}${letters(String(counter + 1000))}`.slice(0, 16);
}

export const CLASSIFY: ClassifyConfig = {
  authservId: "mail.yourtal.gaiada.com",
  ownOrgDomains: parseOwnDomains(undefined),
};

export interface MailboxFixture extends MailboxRow {
  readonly address: string;
}

export async function insertMailbox(
  pool: Pool,
  over: Partial<{
    region: "AU" | "ID";
    status: MailboxRow["status"];
    statements: boolean;
    alerts: boolean;
    emailState: string | null;
    junkId: string | null;
    userId: string;
  }> = {},
): Promise<MailboxFixture> {
  const name = localPart();
  const userId = over.userId ?? `sbt6-${RUN}-${randomUUID().slice(0, 8)}`;
  const { rows } = await pool.query<MailboxRow>(
    `INSERT INTO spambank.mailbox
       (user_id, region, local_part, domain, status, enabled_via, statements_to_snapapp,
        new_mail_alerts, email_state, junk_mailbox_id, stalwart_account_id)
     VALUES ($1, $2, $3, 'yourtal.gaiada.com', $4, 'yourtal', $5, $6, $7, $8, $9)
     RETURNING ${MAILBOX_COLUMNS}`,
    [
      userId,
      over.region ?? "AU",
      name,
      over.status ?? "active",
      over.statements ?? false,
      over.alerts ?? true,
      over.emailState === undefined ? "s0" : over.emailState,
      over.junkId === undefined ? "junk" : over.junkId,
      `acct-${name}`,
    ],
  );
  const row = rows[0];
  if (row === undefined) throw new Error("mailbox insert returned nothing");
  return { ...row, address: `${name}@yourtal.gaiada.com` };
}

/** A SnapApp sub for the person, with live consent unless `ended`. */
export async function linkSnapapp(
  pool: Pool,
  userId: string,
  sector: string,
  options: { ended?: boolean } = {},
): Promise<string> {
  const sub = `sub-${randomUUID()}`;
  await pool.query("INSERT INTO oidc.subject (sector, user_id, sub) VALUES ($1, $2, $3)", [
    sector,
    userId,
    sub,
  ]);
  await pool.query(
    `INSERT INTO oidc.app_consent
       (user_id, sector, scopes, policy_version_id, granted_via, granted_at, ended_at, end_reason)
     VALUES ($1, $2, ARRAY['openid','account'], 'pv-test', 'consent_screen', now(), $3, $4)`,
    [
      userId,
      sector,
      options.ended === true ? new Date() : null,
      options.ended === true ? "withdrawn" : null,
    ],
  );
  return sub;
}

export async function deleteMailboxes(pool: Pool, ids: readonly string[]): Promise<void> {
  if (ids.length === 0) return;
  const { rows } = await pool.query<{ user_id: string }>(
    "SELECT user_id FROM spambank.mailbox WHERE id = ANY($1::uuid[])",
    [ids],
  );
  await pool.query("DELETE FROM spambank.mailbox WHERE id = ANY($1::uuid[])", [ids]);
  const users = rows.map((row) => row.user_id);
  await pool.query("DELETE FROM oidc.app_consent WHERE user_id = ANY($1::text[])", [users]);
  await pool.query("DELETE FROM oidc.subject WHERE user_id = ANY($1::text[])", [users]);
}

export interface RawEmailOptions {
  readonly id: string;
  /** Mailbox ids the message is in, by Stalwart id. */
  readonly in?: readonly string[];
  readonly receivedAt?: Date;
  readonly subject?: string;
  readonly keywords?: readonly string[];
  readonly attachments?: readonly {
    blobId: string;
    name: string;
    type: string;
    size: number;
  }[];
  /** Sender header fields; a qualifying newsletter by default. */
  readonly sender?: object;
}

/** An `Email/get` list entry, as Stalwart would send it. */
export function rawEmail(options: RawEmailOptions): Record<string, unknown> {
  return {
    ...(options.sender ?? newsletter()),
    id: options.id,
    mailboxIds: Object.fromEntries((options.in ?? ["inbox"]).map((id) => [id, true])),
    keywords: Object.fromEntries((options.keywords ?? []).map((keyword) => [keyword, true])),
    receivedAt: (options.receivedAt ?? new Date()).toISOString(),
    subject: options.subject ?? "Spring sale",
    attachments: options.attachments ?? [],
  };
}

/** `Mailbox/get`'s list for a normal Spambank account. */
export function mailboxList(unread = 1): Record<string, unknown>[] {
  return [
    { id: "inbox", role: "inbox", name: "Inbox", unreadEmails: unread },
    { id: "spam", role: "junk", name: "Spam", unreadEmails: 0 },
    { id: "junk", role: null, name: "Junk", unreadEmails: 0 },
    { id: "sent", role: "sent", name: "Sent", unreadEmails: 0 },
    { id: "drafts", role: "drafts", name: "Drafts", unreadEmails: 0 },
    { id: "trash", role: "trash", name: "Trash", unreadEmails: 0 },
  ];
}

export function failure(code: SpambankFailure["code"]): SpambankFailure {
  return {
    kind: "server_error",
    boundary: "spambank",
    detail: `test: ${code}`,
    mayHaveSucceeded: false,
    code,
  };
}

export interface Account {
  /** The Email state Stalwart is at. */
  state: string;
  /** What `Email/changes` answers, by `sinceState`; missing means "cannotCalculateChanges". */
  changes: Record<string, { created: string[]; newState: string; hasMore?: boolean }>;
  emails: Record<string, Record<string, unknown>>;
  mailboxes: Record<string, unknown>[];
  /** Fail every call with this. */
  down?: SpambankFailure;
  /** The `Email/query` ids a resync reads. */
  recent?: string[];
  /** Bytes served for a blob download. */
  blobs?: Record<string, { type: string; bytes: Uint8Array; status?: number }>;
  readonly requests: JmapRequest[];
  readonly paths: string[];
}

export function account(over: Partial<Account> = {}): Account {
  return {
    state: "s0",
    changes: {},
    emails: {},
    mailboxes: mailboxList(),
    requests: [],
    paths: [],
    ...over,
  };
}

function methodResult(
  script: Account,
  name: string,
  args: Record<string, unknown>,
): Record<string, unknown> | { error: string } {
  switch (name) {
    case "Email/changes": {
      const since = String(args["sinceState"]);
      const found = script.changes[since];
      if (found === undefined) return { error: "cannotCalculateChanges" };
      return {
        accountId: "A1",
        oldState: since,
        newState: found.newState,
        hasMoreChanges: found.hasMore === true,
        created: found.created,
        updated: [],
        destroyed: [],
      };
    }
    case "Email/get": {
      const ids = Array.isArray(args["ids"]) ? (args["ids"] as string[]) : [];
      return {
        accountId: "A1",
        state: script.state,
        list: ids.flatMap((id) => (script.emails[id] === undefined ? [] : [script.emails[id]])),
        notFound: ids.filter((id) => script.emails[id] === undefined),
      };
    }
    case "Email/query":
      return { accountId: "A1", ids: script.recent ?? [], total: (script.recent ?? []).length };
    case "Mailbox/get":
      return { accountId: "A1", state: "m0", list: script.mailboxes, notFound: [] };
    default:
      return { error: "unknownMethod" };
  }
}

/** A scripted Stalwart: the driver, with one account per `script`. */
export function fakeDriver(script: Account): SpambankDriver {
  const client: SpambankAccountClient = {
    login: `fake-${randomUUID()}@yourtal.gaiada.com`,
    jmap(request: JmapRequest): Promise<SpambankResult<JmapResponse>> {
      script.requests.push(request);
      if (script.down !== undefined) return Promise.resolve(err(script.down));
      return Promise.resolve(
        ok({
          methodResponses: request.methodCalls.map(([name, args, callId]) => {
            const result = methodResult(script, name, args);
            return "error" in result
              ? (["error", { type: result.error }, callId] as const)
              : ([name, result, callId] as const);
          }),
        }),
      );
    },
    fetch(path: string): Promise<SpambankResult<Response>> {
      script.paths.push(path);
      if (script.down !== undefined) return Promise.resolve(err(script.down));
      if (path === "/jmap/session") {
        return Promise.resolve(
          ok(
            Response.json({
              primaryAccounts: { "urn:ietf:params:jmap:mail": "A1" },
              accounts: { A1: {} },
              downloadUrl:
                "https://mail.yourtal.gaiada.com/jmap/download/{accountId}/{blobId}/{name}?accept={type}",
            }),
          ),
        );
      }
      const match = /^\/jmap\/download\/A1\/([^/]+)\//.exec(path);
      const blob = match?.[1] === undefined ? undefined : script.blobs?.[match[1]];
      if (blob === undefined) return Promise.resolve(ok(new Response("no", { status: 404 })));
      return Promise.resolve(
        ok(
          new Response(Buffer.from(blob.bytes), {
            status: blob.status ?? 200,
            headers: { "content-type": blob.type },
          }),
        ),
      );
    },
  };
  return {
    mode: "live",
    listDomains: () => Promise.resolve(ok([])),
    createAccount: () => Promise.resolve(err(failure("simulated"))),
    destroyAccount: () => Promise.resolve(ok(undefined)),
    createAppPassword: () => Promise.resolve(err(failure("simulated"))),
    listAppPasswords: () => Promise.resolve(ok([])),
    revokeAppPassword: () => Promise.resolve(ok(undefined)),
    account: () => client,
  };
}
