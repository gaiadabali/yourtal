import { err, ok } from "neverthrow";
import type {
  JmapRequest,
  SpambankAccountClient,
  SpambankDriver,
  SpambankFailure,
  UpstreamInit,
} from "@yourtal/drivers/spambank";
import { loginFor } from "@yourtal/drivers/spambank";

/**
 * A fake Stalwart behind the Spambank driver's account client, for the mail API's tests. Each login
 * is its own account; like the real server, it only ever answers about the account that logged in
 * (another account id is 403). It records what the proxy sent so tests can check header hygiene.
 */

type Json = Record<string, unknown>;

export const PUBLIC = "https://mail.yourtal.gaiada.com";

export interface FakeEmail {
  id: string;
  mailboxIds: Record<string, boolean>;
  keywords: Record<string, boolean>;
  from: { email: string }[];
  html?: string;
  text?: string;
  attachments?: { blobId: string; type: string; cid?: string; size: number }[];
  listUnsubscribe?: string[];
  listUnsubscribePost?: string;
}

export interface FakeAccount {
  readonly login: string;
  readonly accountId: string;
  readonly emails: Map<string, FakeEmail>;
  readonly blobs: Map<string, { bytes: Uint8Array; type: string }>;
  readonly submissions: Json[];
  readonly streams: Set<ReadableStreamDefaultController<Uint8Array>>;
}

export interface Recorded {
  readonly login: string;
  readonly path: string;
  readonly method: string;
  readonly headers: Readonly<Record<string, string>>;
}

const MAILBOXES = [
  { id: "mb-inbox", name: "Inbox", role: "inbox" },
  { id: "mb-spam", name: "Spam", role: "junk" },
  { id: "mb-junk", name: "Junk", role: null },
  { id: "mb-sent", name: "Sent", role: "sent" },
  { id: "mb-drafts", name: "Drafts", role: "drafts" },
  { id: "mb-trash", name: "Trash", role: "trash" },
];

function json(status: number, body: unknown, type = "application/json"): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": type } });
}

function isRecord(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export class FakeStalwart {
  readonly accounts = new Map<string, FakeAccount>();
  readonly requests: Recorded[] = [];
  /** `simulated` makes every account call fail the way the simulated driver does. */
  failure: SpambankFailure | undefined;
  private sequence = 0;

  add(localPart: string, domain: string, accountId: string): FakeAccount {
    const login = loginFor(localPart, domain);
    const account: FakeAccount = {
      login,
      accountId,
      emails: new Map(),
      blobs: new Map(),
      submissions: [],
      streams: new Set(),
    };
    this.accounts.set(login, account);
    return account;
  }

  /** Pushes a StateChange to every open EventSource of the account. */
  push(account: FakeAccount, state: string): void {
    const event = `event: state\ndata: ${JSON.stringify({ "@type": "StateChange", changed: { [account.accountId]: { Email: state } } })}\n\n`;
    for (const controller of account.streams) controller.enqueue(new TextEncoder().encode(event));
  }

  driver(): SpambankDriver {
    const unused = (): Promise<never> => Promise.reject(new Error("not used by the mail API"));
    return {
      mode: "live",
      listDomains: unused,
      createAccount: unused,
      destroyAccount: unused,
      createAppPassword: unused,
      listAppPasswords: unused,
      revokeAppPassword: unused,
      account: (localPart, domain) => this.client(loginFor(localPart, domain)),
    };
  }

  private client(login: string): SpambankAccountClient {
    return {
      login,
      jmap: async (request: JmapRequest) => {
        const res = await this.handle(login, "/jmap/", {
          method: "POST",
          body: JSON.stringify({ using: request.using, methodCalls: request.methodCalls }),
        });
        if (res.isErr()) return err(res.error);
        const body: unknown = await res.value.json();
        const responses =
          isRecord(body) && Array.isArray(body.methodResponses) ? body.methodResponses : [];
        return ok({ methodResponses: responses as [string, Json, string][] });
      },
      fetch: (path: string, init?: UpstreamInit) => this.handle(login, path, init ?? {}),
    };
  }

  private async handle(login: string, path: string, init: UpstreamInit) {
    const headers: Record<string, string> = { ...(init.headers ?? {}) };
    if (init.clientIp !== undefined) headers["x-forwarded-for"] = init.clientIp;
    this.requests.push({ login, path, method: init.method ?? "GET", headers });
    if (this.failure !== undefined) return err(this.failure);
    const account = this.accounts.get(login);
    if (account === undefined) return ok(json(401, { type: "unauthorized" }));
    const url = new URL(path, "http://127.0.0.1:18080");
    const parts = url.pathname.split("/").filter((p) => p !== "");
    if (url.pathname === "/jmap/session") return ok(json(200, this.session(account)));
    if (url.pathname === "/jmap/" && init.method === "POST") {
      const body: unknown = JSON.parse(typeof init.body === "string" ? init.body : "{}");
      return ok(json(200, this.api(account, body)));
    }
    if (parts[1] === "upload") {
      if (parts[2] !== account.accountId) return ok(json(403, { type: "forbidden" }));
      const bytes = new Uint8Array(await new Response(init.body).arrayBuffer());
      const blobId = `B${String(++this.sequence)}`;
      const type = headers["content-type"] ?? "application/octet-stream";
      account.blobs.set(blobId, { bytes, type });
      return ok(json(201, { accountId: account.accountId, blobId, type, size: bytes.byteLength }));
    }
    if (parts[1] === "download") {
      if (parts[2] !== account.accountId) return ok(json(403, { type: "forbidden" }));
      const blob = account.blobs.get(parts[3] ?? "");
      if (blob === undefined) return ok(json(404, { type: "notFound" }));
      return ok(
        new Response(blob.bytes, {
          status: 200,
          headers: {
            "content-type": url.searchParams.get("accept") ?? blob.type,
            "content-length": String(blob.bytes.byteLength),
          },
        }),
      );
    }
    if (parts[1] === "eventsource") {
      let controller!: ReadableStreamDefaultController<Uint8Array>;
      const stream = new ReadableStream<Uint8Array>({
        start(c) {
          controller = c;
          c.enqueue(new TextEncoder().encode(": connected\n\n"));
        },
        cancel: () => {
          account.streams.delete(controller);
        },
      });
      account.streams.add(controller);
      init.signal?.addEventListener("abort", () => {
        account.streams.delete(controller);
        try {
          controller.close();
        } catch {
          // already closed
        }
      });
      return ok(
        new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } }),
      );
    }
    return ok(json(404, { type: "notFound" }));
  }

  private session(account: FakeAccount): Json {
    const caps = {
      "urn:ietf:params:jmap:core": { maxSizeUpload: 50_000_000 },
      "urn:ietf:params:jmap:mail": {},
      "urn:ietf:params:jmap:submission": {},
      "urn:ietf:params:jmap:sieve": {},
      "urn:stalwart:jmap": {},
    };
    return {
      capabilities: caps,
      accounts: {
        [account.accountId]: { name: account.login, isPersonal: true, accountCapabilities: caps },
        shared9: { name: "someone else", isPersonal: false, accountCapabilities: caps },
      },
      primaryAccounts: Object.fromEntries(Object.keys(caps).map((k) => [k, account.accountId])),
      username: account.login,
      apiUrl: `${PUBLIC}/jmap/`,
      downloadUrl: `${PUBLIC}/jmap/download/{accountId}/{blobId}/{name}?accept={type}`,
      uploadUrl: `${PUBLIC}/jmap/upload/{accountId}/`,
      eventSourceUrl: `${PUBLIC}/jmap/eventsource/?types={types}&closeafter={closeafter}&ping={ping}`,
      state: "s1",
    };
  }

  private api(account: FakeAccount, body: unknown): Json {
    const calls = isRecord(body) && Array.isArray(body.methodCalls) ? body.methodCalls : [];
    const responses: unknown[] = [];
    for (const call of calls) {
      if (!Array.isArray(call)) continue;
      const [name, args, callId] = call as [string, Json, string];
      if (args.accountId !== undefined && args.accountId !== account.accountId) {
        responses.push(["error", { type: "accountNotFound" }, callId]);
        continue;
      }
      responses.push([name, this.method(account, name, args), callId]);
    }
    return { methodResponses: responses, sessionState: "s1" };
  }

  private method(account: FakeAccount, name: string, args: Json): Json {
    switch (name) {
      case "Mailbox/get":
        return { accountId: account.accountId, state: "m1", list: MAILBOXES, notFound: [] };
      case "Identity/get":
        return { accountId: account.accountId, list: [{ id: "ident1", email: account.login }] };
      case "Email/get": {
        const ids = Array.isArray(args.ids) ? (args.ids as string[]) : [];
        const list = ids.flatMap((id) => {
          const e = account.emails.get(id);
          if (e === undefined) return [];
          const htmlPart = e.html === undefined ? [] : [{ partId: "h", type: "text/html" }];
          const textPart = e.text === undefined ? [] : [{ partId: "t", type: "text/plain" }];
          return [
            {
              id: e.id,
              keywords: e.keywords,
              mailboxIds: e.mailboxIds,
              from: e.from,
              htmlBody: [...htmlPart, ...(htmlPart.length === 0 ? textPart : [])],
              bodyValues: {
                ...(e.html === undefined ? {} : { h: { value: e.html, isTruncated: false } }),
                ...(e.text === undefined ? {} : { t: { value: e.text, isTruncated: false } }),
              },
              attachments: e.attachments ?? [],
              "header:List-Unsubscribe:asURLs": e.listUnsubscribe ?? null,
              "header:List-Unsubscribe-Post:asText": e.listUnsubscribePost ?? null,
            },
          ];
        });
        return { accountId: account.accountId, list, notFound: [] };
      }
      case "Email/set": {
        const created: Json = {};
        for (const cid of Object.keys(isRecord(args.create) ? args.create : {})) {
          const id = `E${String(++this.sequence)}`;
          account.emails.set(id, { id, mailboxIds: {}, keywords: {}, from: [] });
          created[cid] = { id };
        }
        for (const [id, patch] of Object.entries(isRecord(args.update) ? args.update : {})) {
          const e = account.emails.get(id);
          if (e === undefined || !isRecord(patch)) continue;
          for (const [key, value] of Object.entries(patch)) {
            if (key.startsWith("keywords/")) e.keywords[key.slice(9)] = value === true;
            if (key === "mailboxIds" && isRecord(value))
              e.mailboxIds = { ...(value as Record<string, boolean>) };
          }
        }
        return { accountId: account.accountId, created };
      }
      case "EmailSubmission/set": {
        const created: Json = {};
        const notCreated: Json = {};
        for (const [cid, sub] of Object.entries(isRecord(args.create) ? args.create : {})) {
          account.submissions.push(isRecord(sub) ? sub : {});
          const rcpt =
            isRecord(sub) && isRecord(sub.envelope) && Array.isArray(sub.envelope.rcptTo)
              ? sub.envelope.rcptTo
              : [];
          if (JSON.stringify(rcpt).includes("reject@"))
            notCreated[cid] = { type: "forbiddenToSend" };
          else created[cid] = { id: `S${String(++this.sequence)}` };
        }
        return { accountId: account.accountId, created, notCreated };
      }
      default:
        return { echoed: args };
    }
  }
}
