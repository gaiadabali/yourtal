import type {
  MachineMailboxStatus,
  MailboxQuota,
  MailboxSettings,
  MailboxStatus,
} from "@yourtal/contracts/spambank/management";
import type { MailboxRecord } from "../persistence/mailbox.store";
import { addressOf } from "./deps";
import type { ManagementDeps } from "./deps";

/**
 * What a screen needs to know about a person's mailbox (spambank/BUILD.md section 5.1, 5.2): off, on,
 * suspended or not allowed, with the address and the quota when there is a mailbox.
 */

/** Who is asking, as far as the answer depends on it. */
export interface StatusSubject {
  readonly userId: string;
  /** An adult. Teen accounts never have a mailbox. */
  readonly adult: boolean;
  /** The YourTal account is on hold. */
  readonly onHold: boolean;
}

/** The quota is a courtesy: a slow or missing mail server must not slow or fail the status. */
const QUOTA_TIMEOUT_MS = 3000;

function stateOf(mailbox: MailboxRecord | null): MailboxStatus["state"] {
  if (mailbox?.status === "active") return "on";
  if (mailbox?.status === "suspended") return "suspended";
  return "off";
}

async function quotaOf(
  deps: ManagementDeps,
  mailbox: MailboxRecord,
): Promise<MailboxQuota | undefined> {
  // The simulator has no mail server: nothing is stored there.
  if (deps.driver.mode !== "live" || mailbox.status !== "active") return undefined;
  const limitBytes = deps.config.quotaBytes;
  try {
    const client = deps.driver.account(mailbox.localPart, mailbox.domain);
    const session = await client.fetch("/jmap/session", { timeoutMs: QUOTA_TIMEOUT_MS });
    if (session.isErr()) return undefined;
    const body: unknown = await session.value.json();
    const primary =
      typeof body === "object" && body !== null
        ? (body as { primaryAccounts?: Record<string, unknown> }).primaryAccounts
        : undefined;
    const accountId = primary?.["urn:ietf:params:jmap:mail"];
    if (typeof accountId !== "string") return undefined;
    const answer = await client.jmap({
      using: ["urn:ietf:params:jmap:core", "urn:ietf:params:jmap:quota"],
      methodCalls: [["Quota/get", { accountId, ids: null }, "q"]],
    });
    if (answer.isErr()) return undefined;
    const response = answer.value.methodResponses.find(([, , callId]) => callId === "q");
    const list = response?.[0] === "Quota/get" ? response[1]["list"] : undefined;
    if (!Array.isArray(list)) return undefined;
    for (const entry of list) {
      const quota = entry as { resourceType?: unknown; used?: unknown; hardLimit?: unknown };
      if (quota.resourceType === "octets" && typeof quota.used === "number") {
        return {
          limitBytes: typeof quota.hardLimit === "number" ? quota.hardLimit : limitBytes,
          usedBytes: quota.used,
        };
      }
    }
    return undefined;
  } catch {
    return undefined;
  }
}

async function statusAndMailbox(
  deps: ManagementDeps,
  subject: StatusSubject,
): Promise<{ status: MailboxStatus; mailbox: MailboxRecord | null }> {
  if (!subject.adult || subject.onHold) {
    return { status: { available: true, state: "not_allowed" }, mailbox: null };
  }
  const mailbox = await deps.store.find(subject.userId);
  const state = stateOf(mailbox);
  if (mailbox === null || (state !== "on" && state !== "suspended")) {
    return { status: { available: true, state: "off" }, mailbox };
  }
  const quota = await quotaOf(deps, mailbox);
  return {
    status: {
      available: true,
      state,
      address: addressOf(mailbox),
      ...(quota === undefined ? {} : { quota }),
      createdAt: mailbox.createdAt.toISOString(),
    },
    mailbox,
  };
}

export async function mailboxStatus(
  deps: ManagementDeps,
  subject: StatusSubject,
): Promise<MailboxStatus> {
  return (await statusAndMailbox(deps, subject)).status;
}

export function settingsOf(mailbox: MailboxRecord | null): MailboxSettings {
  return {
    statementsToSnapApp: mailbox?.statementsToSnapapp ?? false,
    newMailAlerts: mailbox?.newMailAlerts ?? true,
  };
}

/** The machine `/status`: the same, plus the settings an app may read. */
export async function machineMailboxStatus(
  deps: ManagementDeps,
  subject: StatusSubject,
): Promise<MachineMailboxStatus> {
  const { status, mailbox } = await statusAndMailbox(deps, subject);
  return { ...status, settings: settingsOf(mailbox) };
}
