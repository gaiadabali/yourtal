import { APP_PASSWORDS_MAX } from "@yourtal/contracts/spambank/management";
import type { AppPasswordCreated, AppPasswordList } from "@yourtal/contracts/spambank/management";
import type { SpambankFailure } from "@yourtal/drivers/spambank";
import type { MailboxRecord } from "../persistence/mailbox.store";
import { addressOf } from "./deps";
import type { ManagementDeps } from "./deps";
import { appPasswordLimit, spambankUnavailable } from "./errors";
import { activeMailbox } from "./session";

/**
 * App passwords for the phone's mail app (spambank/BUILD.md section 4.10): a name, a secret shown once,
 * at most five. Only a YourTal session or an app's server (with its client-credentials token) gets
 * here; a mail token cannot, so a stolen 30-minute token never becomes a permanent password.
 */

/** The ports a phone's mail app connects to (BUILD.md 4.10). */
const IMAP_PORT = 993;
const SMTP_PORT = 465;

function accountIdOf(mailbox: MailboxRecord): string {
  // A mailbox that is `active` always has its account; this is the broken-data case.
  if (mailbox.stalwartAccountId === null) throw spambankUnavailable();
  return mailbox.stalwartAccountId;
}

function failed(deps: ManagementDeps, what: string, failure: SpambankFailure): never {
  const message = `spambank app password: ${what} failed (${failure.code}): ${failure.detail}`;
  if (failure.code === "upstream_auth") deps.log.error(message);
  else deps.log.warn(message);
  throw spambankUnavailable();
}

export async function listAppPasswords(
  deps: ManagementDeps,
  userId: string,
): Promise<AppPasswordList> {
  const mailbox = await activeMailbox(deps, userId);
  const listed = await deps.driver.listAppPasswords(accountIdOf(mailbox));
  if (listed.isErr()) failed(deps, "listing", listed.error);
  return {
    items: listed.value.map((item) => ({
      id: item.id,
      name: item.name,
      createdAt: item.createdAt,
    })),
  };
}

export async function createAppPassword(
  deps: ManagementDeps,
  userId: string,
  name: string,
): Promise<AppPasswordCreated> {
  // One person at a time, so two quick taps cannot make a sixth.
  return deps.store.withUserLock(userId, async () => {
    const mailbox = await activeMailbox(deps, userId);
    const accountId = accountIdOf(mailbox);
    const existing = await deps.driver.listAppPasswords(accountId);
    if (existing.isErr()) failed(deps, "counting", existing.error);
    if (existing.value.length >= APP_PASSWORDS_MAX) throw appPasswordLimit();
    const created = await deps.driver.createAppPassword(accountId, name);
    if (created.isErr()) failed(deps, "creating", created.error);
    const host = deps.config.publicHost;
    return {
      id: created.value.id,
      name: created.value.name,
      createdAt: created.value.createdAt,
      secret: created.value.secret,
      username: addressOf(mailbox),
      imap: { host, port: IMAP_PORT, security: "ssl" as const },
      smtp: { host, port: SMTP_PORT, security: "ssl" as const },
    };
  });
}

export async function revokeAppPassword(
  deps: ManagementDeps,
  userId: string,
  appPasswordId: string,
): Promise<void> {
  const mailbox = await activeMailbox(deps, userId);
  // Acts on this mailbox's account only, so an id that belongs to another person's does nothing.
  const revoked = await deps.driver.revokeAppPassword(accountIdOf(mailbox), appPasswordId);
  if (revoked.isErr()) failed(deps, "revoking", revoked.error);
}
