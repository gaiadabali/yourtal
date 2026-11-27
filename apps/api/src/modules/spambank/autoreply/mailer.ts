import type { SpambankAccountClient, SpambankDriver } from "@yourtal/drivers/spambank";
import {
  JmapProblem,
  call,
  isRecord,
  readSession,
  resultOf,
  uploadPath,
} from "../ingest/jmap-session";
import type { JmapSession } from "../ingest/jmap-session";

/**
 * Sending as the system account `reply@<reply domain>` (BUILD.md §4.6, §7 "Auto-reply"): the raw message is
 * uploaded as a blob, imported into the account's Sent mailbox and submitted with an explicit envelope
 * from the reply address, so Stalwart signs it with the reply domain's DKIM key (selector `helios`).
 * Bounces and complaints come back to the same account (and its `abuse@`/`postmaster@` siblings), where
 * `spambank.reply-inbox` reads them.
 */

export const REPLY_LOCAL_PART = "reply";
/** The system addresses on the reply domain (U12 fallback: separate accounts, all read by reply-inbox). */
export const SYSTEM_LOCAL_PARTS = ["reply", "abuse", "postmaster"] as const;

const CORE = "urn:ietf:params:jmap:core";
const MAIL = "urn:ietf:params:jmap:mail";
const SUBMISSION = "urn:ietf:params:jmap:submission";

export type SendOutcome =
  | { readonly ok: true; readonly emailId: string }
  | {
      readonly ok: false;
      readonly code: string;
      readonly detail: string;
      /** Nothing reached Stalwart's queue: trying again later is safe. */
      readonly nothingSent: boolean;
    };

export interface SystemMailer {
  readonly fromAddress: string;
  /** Session, Sent mailbox and identity, cached. Throws `JmapProblem` when Stalwart cannot be used. */
  prepare(): Promise<void>;
  send(raw: string, rcptTo: readonly string[]): Promise<SendOutcome>;
}

interface Prepared {
  readonly session: JmapSession;
  readonly sentId: string;
  readonly identityId: string;
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

function list(result: Record<string, unknown>): Record<string, unknown>[] {
  const raw = result["list"];
  return Array.isArray(raw) ? raw.filter(isRecord) : [];
}

function createdId(result: Record<string, unknown>, key: string): string | undefined {
  const created = result["created"];
  return isRecord(created) && isRecord(created[key]) ? str(created[key]["id"]) : undefined;
}

function notCreated(result: Record<string, unknown>, key: string): string | undefined {
  const failed = result["notCreated"];
  if (!isRecord(failed) || !isRecord(failed[key])) return undefined;
  const entry = failed[key];
  return [str(entry["type"]) ?? "rejected", str(entry["description"])]
    .filter((v) => v !== undefined)
    .join(": ");
}

export function createStalwartMailer(driver: SpambankDriver, replyDomain: string): SystemMailer {
  const fromAddress = `${REPLY_LOCAL_PART}@${replyDomain}`;
  const client: SpambankAccountClient = driver.account(REPLY_LOCAL_PART, replyDomain);
  let prepared: Prepared | undefined;

  async function load(): Promise<Prepared> {
    if (prepared !== undefined) return prepared;
    const session = await readSession(client);
    const responses = await call(client, [
      ["Mailbox/get", { accountId: session.accountId, properties: ["role", "name"] }, "m"],
      ["Identity/get", { accountId: session.accountId }, "i"],
    ]);
    const mailboxes = list(resultOf(responses, "m"));
    const sent =
      mailboxes.find((m) => m["role"] === "sent") ?? mailboxes.find((m) => m["role"] === "inbox");
    const sentId = sent === undefined ? undefined : str(sent["id"]);
    if (sentId === undefined) throw new JmapProblem("rejected", "the reply account has no mailbox");
    let identityId = str(
      list(resultOf(responses, "i")).find((i) => str(i["email"])?.toLowerCase() === fromAddress)?.[
        "id"
      ],
    );
    if (identityId === undefined) {
      const made = await call(client, [
        [
          "Identity/set",
          {
            accountId: session.accountId,
            create: { n: { email: fromAddress, name: "GOD (Global Omni Data)" } },
          },
          "n",
        ],
      ]);
      identityId = createdId(resultOf(made, "n"), "n");
      if (identityId === undefined) {
        throw new JmapProblem(
          "rejected",
          "the reply account has no identity and none could be made",
        );
      }
    }
    prepared = { session, sentId, identityId };
    return prepared;
  }

  return {
    fromAddress,

    async prepare(): Promise<void> {
      await load();
    },

    async send(raw: string, rcptTo: readonly string[]): Promise<SendOutcome> {
      let ready: Prepared;
      try {
        ready = await load();
      } catch (error) {
        return {
          ok: false,
          code: error instanceof JmapProblem ? error.code : "unavailable",
          detail: error instanceof Error ? error.message : "prepare failed",
          nothingSent: true,
        };
      }
      const uploaded = await client.fetch(uploadPath(ready.session), {
        method: "POST",
        headers: { "content-type": "message/rfc822" },
        body: Buffer.from(raw, "utf8"),
      });
      if (uploaded.isErr()) {
        return {
          ok: false,
          code: uploaded.error.code,
          detail: uploaded.error.detail,
          nothingSent: true,
        };
      }
      let blobId: string | undefined;
      try {
        const body: unknown = uploaded.value.ok ? await uploaded.value.json() : undefined;
        if (!uploaded.value.ok) await uploaded.value.body?.cancel();
        blobId = isRecord(body) ? str(body["blobId"]) : undefined;
      } catch {
        blobId = undefined;
      }
      if (blobId === undefined) {
        return {
          ok: false,
          code: "unavailable",
          detail: `upload answered ${String(uploaded.value.status)} without a blob id`,
          nothingSent: true,
        };
      }
      const accountId = ready.session.accountId;
      const response = await client.jmap({
        using: [CORE, MAIL, SUBMISSION],
        methodCalls: [
          [
            "Email/import",
            {
              accountId,
              emails: {
                m: { blobId, mailboxIds: { [ready.sentId]: true }, keywords: { $seen: true } },
              },
            },
            "i",
          ],
          [
            "EmailSubmission/set",
            {
              accountId,
              create: {
                s: {
                  identityId: ready.identityId,
                  emailId: "#m",
                  envelope: {
                    mailFrom: { email: fromAddress },
                    rcptTo: rcptTo.map((email) => ({ email })),
                  },
                },
              },
            },
            "s",
          ],
        ],
      });
      if (response.isErr()) {
        // The request may have reached Stalwart: never retried, so a reply is sent at most once.
        prepared = undefined;
        return {
          ok: false,
          code: response.error.code,
          detail: response.error.detail,
          nothingSent: false,
        };
      }
      const byId = new Map(
        response.value.methodResponses.map(([name, result, id]) => [id, { name, result }]),
      );
      const imported = byId.get("i");
      const submitted = byId.get("s");
      if (imported === undefined || imported.name === "error") {
        prepared = undefined;
        return {
          ok: false,
          code: "rejected",
          detail: `Email/import: ${str(imported?.result["type"]) ?? "no answer"}`,
          nothingSent: true,
        };
      }
      const emailId = createdId(imported.result, "m");
      if (emailId === undefined) {
        return {
          ok: false,
          code: "rejected",
          detail: `Email/import: ${notCreated(imported.result, "m") ?? "not created"}`,
          nothingSent: true,
        };
      }
      if (submitted === undefined || submitted.name === "error") {
        prepared = undefined;
        return {
          ok: false,
          code: "rejected",
          detail: `EmailSubmission/set: ${str(submitted?.result["type"]) ?? "no answer"}`,
          nothingSent: true,
        };
      }
      if (createdId(submitted.result, "s") === undefined) {
        return {
          ok: false,
          code: "rejected",
          detail: `EmailSubmission/set: ${notCreated(submitted.result, "s") ?? "not created"}`,
          nothingSent: true,
        };
      }
      return { ok: true, emailId };
    },
  };
}
