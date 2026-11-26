import type {
  JmapMethodCall,
  SpambankAccountClient,
  SpambankFailure,
} from "@yourtal/drivers/spambank";

/**
 * Setting up a new mailbox as the account itself (spambank/BUILD.md section 4.2): find its folders,
 * rename the filter's folder to Spam, add the custom Junk folder, install the Sieve rule that files
 * bulk mail there, make sure the address has an identity, and note the mailbox state so only mail
 * that arrives after switch-on is processed. Every step can be run again: a retry after a failure
 * finds what an earlier attempt made.
 *
 * The first two steps are required (a mailbox without its folders is not usable) and fail the whole
 * provisioning with the driver's failure. The Sieve rule and the identity are optional: the Stalwart
 * shapes they use (JMAP Sieve, `Identity/set`) are [UNVERIFIED] until day-1's fixtures, and a mailbox
 * that receives and reads mail is better than one that cannot be switched on. What was skipped is
 * returned in `degraded` for the caller to log, and T6's ingest moves bulk mail itself when the rule
 * is missing.
 */

const CORE = "urn:ietf:params:jmap:core";
const MAIL = "urn:ietf:params:jmap:mail";
const SUBMISSION = "urn:ietf:params:jmap:submission";
const SIEVE = "urn:ietf:params:jmap:sieve";

/** The folder Stalwart's spam filter fills, shown to people as "Spam". */
export const SPAM_FOLDER = "Spam";
/** The folder bulk mail is filed in, shown as "Junk" (or "Promotions" when the filter's folder cannot be renamed). */
export const JUNK_FOLDER = "Junk";
export const JUNK_FOLDER_FALLBACK = "Promotions";
const SIEVE_SCRIPT_NAME = "spambank";

export interface ProvisionResult {
  /** The custom bulk-mail folder's JMAP id (`spambank.mailbox.junk_mailbox_id`). */
  readonly junkMailboxId: string;
  /** `Email/get` state: where ingest starts. Null when Stalwart gave none. */
  readonly emailState: string | null;
  /** Optional steps that did not work, in words, for the log. Never contains a credential. */
  readonly degraded: readonly string[];
}

/** A required step failed: the driver's own failure, or a description when Stalwart answered something unusable. */
export class ProvisionError extends Error {
  constructor(
    message: string,
    readonly failure?: SpambankFailure,
  ) {
    super(message);
    this.name = "ProvisionError";
  }
}

type Json = Record<string, unknown>;

const isRecord = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const str = (value: unknown): string | undefined =>
  typeof value === "string" && value !== "" ? value : undefined;

/** One JMAP method as the account; a method-level `error` or a driver failure throws. */
async function method(
  client: SpambankAccountClient,
  name: string,
  args: Json,
  using: readonly string[] = [CORE, MAIL],
): Promise<Json> {
  const call: JmapMethodCall = [name, args, "c1"];
  const result = await client.jmap({ using, methodCalls: [call] });
  if (result.isErr()) throw new ProvisionError(`${name}: ${result.error.detail}`, result.error);
  const found = result.value.methodResponses.find(([, , callId]) => callId === "c1");
  if (found === undefined) throw new ProvisionError(`${name} had no response`);
  const [responseName, value] = found;
  if (responseName === "error") {
    throw new ProvisionError(`${name}: ${str(value["type"]) ?? "error"}`);
  }
  return value;
}

interface SessionInfo {
  readonly accountId: string;
  /** The upload address template, when the session has one. */
  readonly uploadUrl: string | undefined;
}

/** The JMAP account id for this login, and where it uploads, from its session. */
async function sessionOf(client: SpambankAccountClient): Promise<SessionInfo> {
  const response = await client.fetch("/jmap/session");
  if (response.isErr())
    throw new ProvisionError(`session: ${response.error.detail}`, response.error);
  let body: unknown;
  try {
    body = await response.value.json();
  } catch {
    throw new ProvisionError("session: not JSON");
  }
  if (!isRecord(body)) throw new ProvisionError("session: not an object");
  const primary = isRecord(body["primaryAccounts"]) ? body["primaryAccounts"] : {};
  const accounts = isRecord(body["accounts"]) ? Object.keys(body["accounts"]) : [];
  const accountId = str(primary[MAIL]) ?? accounts[0];
  if (accountId === undefined) throw new ProvisionError("session: no account");
  return { accountId, uploadUrl: str(body["uploadUrl"]) };
}

interface Folder {
  readonly id: string;
  readonly name: string;
  readonly role: string | null;
}

function foldersOf(result: Json): Folder[] {
  const list = result["list"];
  if (!Array.isArray(list)) throw new ProvisionError("Mailbox/get had no list");
  const folders: Folder[] = [];
  for (const entry of list) {
    if (!isRecord(entry)) continue;
    const id = str(entry["id"]);
    if (id === undefined) continue;
    folders.push({ id, name: str(entry["name"]) ?? "", role: str(entry["role"]) ?? null });
  }
  return folders;
}

/** `notCreated`/`notUpdated` entry for a key, as a sentence; undefined when the key went through. */
function notDone(result: Json, field: string, key: string): string | undefined {
  const map = result[field];
  if (!isRecord(map)) return undefined;
  const entry = map[key];
  if (!isRecord(entry)) return undefined;
  return str(entry["type"]) ?? "refused";
}

/** The Sieve rule of section 4.2, with the real folder names. Plain text. */
export function sieveScript(spamFolder: string, junkFolder: string): string {
  const quote = (name: string) => `"${name.replace(/[\\"]/g, "")}"`;
  return [
    'require ["fileinto", "mailbox"];',
    "# Spambank (BUILD.md 4.2). Filter-sure spam stays in the junk-role folder.",
    `if header :contains "X-Spam-Status" "Yes" { fileinto ${quote(spamFolder)}; stop; }`,
    'if anyof (exists "List-Unsubscribe", exists "List-Id",',
    '          header :is "Precedence" ["bulk", "list", "junk"]) {',
    `  fileinto :create ${quote(junkFolder)};`,
    "}",
    "",
  ].join("\n");
}

/** Uploads the script and activates it. Throws a ProvisionError with what went wrong. */
async function installSieve(
  client: SpambankAccountClient,
  session: SessionInfo,
  script: string,
): Promise<void> {
  const { accountId, uploadUrl } = session;
  if (uploadUrl === undefined) throw new ProvisionError("the session has no upload address");
  let uploadPath: string;
  try {
    const url = new URL(uploadUrl.replace("{accountId}", encodeURIComponent(accountId)));
    uploadPath = `${url.pathname}${url.search}`;
  } catch {
    throw new ProvisionError("the session's upload address is not a URL");
  }
  const uploaded = await client.fetch(uploadPath, {
    method: "POST",
    headers: { "content-type": "application/sieve" },
    body: script,
  });
  if (uploaded.isErr()) throw new ProvisionError(uploaded.error.detail, uploaded.error);
  if (!uploaded.value.ok) {
    throw new ProvisionError(`upload answered ${String(uploaded.value.status)}`);
  }
  const uploadResult: unknown = await uploaded.value.json();
  const blobId = isRecord(uploadResult) ? str(uploadResult["blobId"]) : undefined;
  if (blobId === undefined) throw new ProvisionError("the upload returned no blob id");
  const set = await method(
    client,
    "SieveScript/set",
    {
      accountId,
      create: { s: { name: SIEVE_SCRIPT_NAME, blobId } },
      onSuccessActivateScript: "#s",
    },
    [CORE, SIEVE],
  );
  const refused = notDone(set, "notCreated", "s");
  // A script of that name from an earlier attempt is as good as a new one.
  if (refused !== undefined && refused !== "alreadyExists") throw new ProvisionError(refused);
}

/**
 * Makes sure the address has an identity (`Identity/get`, then `Identity/set` when there is none),
 * so a client can submit mail from it.
 */
async function ensureIdentity(
  client: SpambankAccountClient,
  accountId: string,
  address: string,
): Promise<void> {
  const existing = await method(
    client,
    "Identity/get",
    { accountId, ids: null, properties: ["id", "email"] },
    [CORE, SUBMISSION],
  );
  const list = existing["list"];
  if (Array.isArray(list) && list.length > 0) return;
  const set = await method(
    client,
    "Identity/set",
    { accountId, create: { i: { name: "", email: address } } },
    [CORE, SUBMISSION],
  );
  const refused = notDone(set, "notCreated", "i");
  if (refused !== undefined) throw new ProvisionError(refused);
}

/**
 * Runs the steps of section 4.2 against a new account. Throws `ProvisionError` when a required step
 * fails; the caller leaves the mailbox `provisioning` and a retry resumes here.
 */
export async function provisionMailbox(
  client: SpambankAccountClient,
  address: string,
): Promise<ProvisionResult> {
  const session = await sessionOf(client);
  const { accountId } = session;

  // 1. Folders by role, never by name.
  const folders = foldersOf(
    await method(client, "Mailbox/get", {
      accountId,
      ids: null,
      properties: ["id", "name", "role"],
    }),
  );
  if (!folders.some((folder) => folder.role === "inbox")) {
    throw new ProvisionError("the new account has no inbox yet");
  }
  const filterFolder = folders.find((folder) => folder.role === "junk");
  if (filterFolder === undefined)
    throw new ProvisionError("the new account has no junk folder yet");

  // 2. The filter's folder is "Spam"; bulk mail gets its own "Junk" (or "Promotions" if the
  // rename is refused and the filter's folder is still called Junk).
  let spamName = filterFolder.name;
  if (spamName !== SPAM_FOLDER) {
    const renamed = await method(client, "Mailbox/set", {
      accountId,
      update: { [filterFolder.id]: { name: SPAM_FOLDER } },
    });
    if (notDone(renamed, "notUpdated", filterFolder.id) === undefined) spamName = SPAM_FOLDER;
  }
  const bulkName =
    spamName.toLowerCase() === JUNK_FOLDER.toLowerCase() ? JUNK_FOLDER_FALLBACK : JUNK_FOLDER;
  let bulk = folders.find((folder) => folder.role === null && folder.name === bulkName);
  if (bulk === undefined) {
    const created = await method(client, "Mailbox/set", {
      accountId,
      create: { j: { name: bulkName, parentId: null } },
    });
    const refused = notDone(created, "notCreated", "j");
    const made = isRecord(created["created"]) ? created["created"]["j"] : undefined;
    const id = isRecord(made) ? str(made["id"]) : undefined;
    if (refused !== undefined || id === undefined) {
      throw new ProvisionError(`creating ${bulkName}: ${refused ?? "no id"}`);
    }
    bulk = { id, name: bulkName, role: null };
  }

  const degraded: string[] = [];

  // 3. The Sieve rule (optional, see the header).
  try {
    await installSieve(client, session, sieveScript(spamName, bulkName));
  } catch (error) {
    degraded.push(`sieve rule not installed (${error instanceof Error ? error.message : "error"})`);
  }

  // 4. An identity for the address (optional).
  try {
    await ensureIdentity(client, accountId, address);
  } catch (error) {
    degraded.push(`identity not created (${error instanceof Error ? error.message : "error"})`);
  }

  // 5. Where ingest starts: only mail after switch-on is processed.
  const state = await method(client, "Email/get", { accountId, ids: [], properties: ["id"] });
  return { junkMailboxId: bulk.id, emailState: str(state["state"]) ?? null, degraded };
}
