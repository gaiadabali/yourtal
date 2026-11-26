import { err, ok } from "neverthrow";
import type {
  AppPasswordSummary,
  JmapRequest,
  SpambankAccountClient,
  SpambankDriver,
  SpambankFailure,
  SpambankResult,
} from "@yourtal/drivers/spambank";

/**
 * A live-mode `SpambankDriver` that behaves like the Stalwart of BUILD.md section 7 closely enough to
 * test provisioning: accounts with the five default folders ("INBOX", "Junk Mail", "Drafts", "Sent
 * Items", "Deleted Items"), JMAP `Mailbox/*`, `Identity/*`, `SieveScript/set`, `Email/get`, and the
 * management calls. Shapes are the ones in STALWART-NOTES.md and the day-1 facts; the knobs make it
 * misbehave in the ways the use-cases must survive. Nothing here touches the network.
 */

export interface FakeStalwartKnobs {
  /** Stalwart is down: every call fails `unavailable`. */
  down: boolean;
  /** Names Stalwart already has accounts for (from a crashed earlier attempt). */
  existingNames: Set<string>;
  /** `Mailbox/set` refuses to rename the junk-role folder. */
  refuseRename: boolean;
  /** JMAP Sieve does not work. */
  failSieve: boolean;
  /** `Identity/set` does not work. */
  failIdentity: boolean;
  /** The new account has no folders yet (they are created on first access). */
  noFoldersYet: boolean;
  /** Our derived credential is refused. */
  refuseCredential: boolean;
  /** What a new account's junk-role folder is called ("Junk Mail" on the live server). */
  defaultJunkName: string;
}

interface Folder {
  id: string;
  name: string;
  role: string | null;
}

interface FakeAccount {
  readonly id: string;
  readonly login: string;
  readonly quotaBytes: number;
  folders: Folder[];
  identities: { id: string; email: string }[];
  sieve: { name: string; active: boolean; script: string }[];
  appPasswords: Map<string, AppPasswordSummary>;
}

const unavailable = (detail: string): SpambankFailure => ({
  kind: "server_error",
  boundary: "spambank",
  detail,
  mayHaveSucceeded: false,
  code: "unavailable",
});

const refusal = (code: SpambankFailure["code"], detail: string): SpambankFailure => ({
  kind: "declined",
  boundary: "spambank",
  detail,
  mayHaveSucceeded: false,
  code,
});

export interface FakeStalwart {
  readonly driver: SpambankDriver;
  readonly knobs: FakeStalwartKnobs;
  readonly accounts: Map<string, FakeAccount>;
  /** Every method name asked of any account, in order. */
  readonly jmapCalls: string[];
}

export function createFakeStalwart(options: { quotaUsed?: number } = {}): FakeStalwart {
  const knobs: FakeStalwartKnobs = {
    down: false,
    existingNames: new Set(),
    refuseRename: false,
    failSieve: false,
    failIdentity: false,
    noFoldersYet: false,
    refuseCredential: false,
    defaultJunkName: "Junk Mail",
  };
  const accounts = new Map<string, FakeAccount>();
  const jmapCalls: string[] = [];
  let sequence = 0;
  const next = (prefix: string) => `${prefix}${String((sequence += 1))}`;

  function defaultFolders(): Folder[] {
    return [
      { id: next("f"), name: "INBOX", role: "inbox" },
      { id: next("f"), name: knobs.defaultJunkName, role: "junk" },
      { id: next("f"), name: "Drafts", role: "drafts" },
      { id: next("f"), name: "Sent Items", role: "sent" },
      { id: next("f"), name: "Deleted Items", role: "trash" },
    ];
  }

  function byLogin(login: string): FakeAccount | undefined {
    return [...accounts.values()].find((account) => account.login === login);
  }

  function methodResult(account: FakeAccount, name: string, args: Record<string, unknown>) {
    jmapCalls.push(name);
    const created: Record<string, unknown> = {};
    const notCreated: Record<string, unknown> = {};
    const notUpdated: Record<string, unknown> = {};
    switch (name) {
      case "Mailbox/get":
        return { list: account.folders.map((folder) => ({ ...folder })) };
      case "Mailbox/set": {
        const update = (args["update"] ?? {}) as Record<string, { name?: string }>;
        for (const [id, change] of Object.entries(update)) {
          if (knobs.refuseRename) {
            notUpdated[id] = { type: "forbidden" };
            continue;
          }
          const folder = account.folders.find((one) => one.id === id);
          if (folder === undefined || change.name === undefined)
            notUpdated[id] = { type: "notFound" };
          else folder.name = change.name;
        }
        const create = (args["create"] ?? {}) as Record<string, { name: string }>;
        for (const [key, value] of Object.entries(create)) {
          if (account.folders.some((folder) => folder.name === value.name)) {
            notCreated[key] = { type: "invalidProperties" };
            continue;
          }
          const folder = { id: next("f"), name: value.name, role: null };
          account.folders.push(folder);
          created[key] = { id: folder.id };
        }
        return { created, notCreated, updated: {}, notUpdated };
      }
      case "Identity/get":
        return { list: account.identities.map((identity) => ({ ...identity })) };
      case "Identity/set": {
        const create = (args["create"] ?? {}) as Record<string, { email: string }>;
        for (const [key, value] of Object.entries(create)) {
          if (knobs.failIdentity) {
            notCreated[key] = { type: "forbidden" };
            continue;
          }
          const identity = { id: next("i"), email: value.email };
          account.identities.push(identity);
          created[key] = { id: identity.id };
        }
        return { created, notCreated };
      }
      case "SieveScript/set": {
        const create = (args["create"] ?? {}) as Record<string, { name: string; blobId: string }>;
        for (const [key, value] of Object.entries(create)) {
          if (knobs.failSieve) {
            notCreated[key] = { type: "forbidden" };
            continue;
          }
          account.sieve.push({
            name: value.name,
            active: args["onSuccessActivateScript"] === `#${key}`,
            script: blobs.get(value.blobId) ?? "",
          });
          created[key] = { id: next("s") };
        }
        return { created, notCreated };
      }
      case "Email/get":
        return { state: "state-0", list: [], notFound: [] };
      case "Quota/get":
        return {
          list: [
            {
              resourceType: "octets",
              used: options.quotaUsed ?? 0,
              hardLimit: account.quotaBytes,
            },
          ],
        };
      default:
        return { type: "unknownMethod" };
    }
  }

  const blobs = new Map<string, string>();

  function accountClient(localPart: string, domain: string): SpambankAccountClient {
    const login = `${localPart}@${domain}`;
    const gate = (): SpambankFailure | undefined => {
      if (knobs.down) return unavailable("Stalwart is down");
      if (knobs.refuseCredential) return refusal("upstream_auth", "credential refused");
      return undefined;
    };
    return {
      login,
      jmap(request: JmapRequest) {
        const failure = gate();
        if (failure !== undefined) return Promise.resolve(err(failure));
        const account = byLogin(login);
        if (account === undefined)
          return Promise.resolve(err(refusal("upstream_auth", "no account")));
        if (knobs.noFoldersYet && account.folders.length === 0) {
          // Folders appear on first access in the field; here a retry finds them.
          account.folders = defaultFolders();
          if (request.methodCalls[0]?.[0] === "Mailbox/get") {
            return Promise.resolve(ok({ methodResponses: [["Mailbox/get", { list: [] }, "c1"]] }));
          }
        }
        return Promise.resolve(
          ok({
            methodResponses: request.methodCalls.map(([name, args, callId]) => {
              const result = methodResult(account, name, args);
              if (result["type"] === "unknownMethod") return ["error", result, callId] as const;
              return [name, result, callId] as const;
            }),
          }),
        );
      },
      fetch(path, init): Promise<SpambankResult<Response>> {
        const failure = gate();
        if (failure !== undefined) return Promise.resolve(err(failure));
        const account = byLogin(login);
        if (account === undefined)
          return Promise.resolve(err(refusal("upstream_auth", "no account")));
        if (path === "/jmap/session") {
          return Promise.resolve(
            ok(
              Response.json({
                primaryAccounts: { "urn:ietf:params:jmap:mail": `jmap-${account.id}` },
                accounts: { [`jmap-${account.id}`]: {} },
                uploadUrl: "https://mail.yourtal.gaiada.com/jmap/upload/{accountId}/",
              }),
            ),
          );
        }
        if (path.startsWith("/jmap/upload/") && init?.method === "POST") {
          const blobId = next("blob");
          blobs.set(blobId, typeof init.body === "string" ? init.body : "");
          return Promise.resolve(ok(Response.json({ blobId, type: "application/sieve" })));
        }
        return Promise.resolve(ok(new Response("not found", { status: 404 })));
      },
    };
  }

  const driver: SpambankDriver = {
    mode: "live",
    listDomains: () =>
      Promise.resolve(
        knobs.down
          ? err(unavailable("Stalwart is down"))
          : ok([
              { id: "b", name: "yourtal.gaiada.com" },
              { id: "c", name: "spambank.yourtal.gaiada.com" },
            ]),
      ),
    createAccount(input) {
      if (knobs.down) return Promise.resolve(err(unavailable("Stalwart is down")));
      const login = `${input.localPart}@${input.domain}`;
      if (knobs.existingNames.has(input.localPart) || byLogin(login) !== undefined) {
        return Promise.resolve(err(refusal("already_exists", "that name is taken")));
      }
      const account: FakeAccount = {
        id: next("acct"),
        login,
        quotaBytes: input.quotaBytes,
        folders: knobs.noFoldersYet ? [] : defaultFolders(),
        identities: [],
        sieve: [],
        appPasswords: new Map(),
      };
      accounts.set(account.id, account);
      return Promise.resolve(ok({ accountId: account.id, login }));
    },
    destroyAccount(accountId) {
      if (knobs.down) return Promise.resolve(err(unavailable("Stalwart is down")));
      accounts.delete(accountId);
      return Promise.resolve(ok(undefined));
    },
    createAppPassword(accountId, name) {
      if (knobs.down) return Promise.resolve(err(unavailable("Stalwart is down")));
      const account = accounts.get(accountId);
      if (account === undefined) return Promise.resolve(err(refusal("not_found", "no account")));
      const id = next("pw");
      const summary: AppPasswordSummary = { id, name, createdAt: "2026-11-28T01:00:00.000Z" };
      account.appPasswords.set(id, summary);
      return Promise.resolve(ok({ ...summary, secret: `app_secret_${id}` }));
    },
    listAppPasswords(accountId) {
      if (knobs.down) return Promise.resolve(err(unavailable("Stalwart is down")));
      const account = accounts.get(accountId);
      if (account === undefined) return Promise.resolve(err(refusal("not_found", "no account")));
      return Promise.resolve(ok([...account.appPasswords.values()]));
    },
    revokeAppPassword(accountId, appPasswordId) {
      if (knobs.down) return Promise.resolve(err(unavailable("Stalwart is down")));
      accounts.get(accountId)?.appPasswords.delete(appPasswordId);
      return Promise.resolve(ok(undefined));
    },
    account: accountClient,
  };

  return { driver, knobs, accounts, jmapCalls };
}
