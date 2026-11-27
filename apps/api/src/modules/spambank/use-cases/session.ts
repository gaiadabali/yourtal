import type { MailSession } from "@yourtal/contracts/spambank/common";
import { mailUrlsFor } from "@yourtal/contracts/spambank/mail";
import { signMailToken } from "../mail-token";
import type { MailboxRecord } from "../persistence/mailbox.store";
import { addressOf, tokenKeyOf } from "./deps";
import type { Caller, ManagementDeps } from "./deps";
import { mailboxErasing, notAllowed, notEnabled } from "./errors";

/**
 * The mailbox a person may use now: `active`, or the refusal to give. Shared by the session, the
 * app-password and the settings use-cases.
 */
export async function activeMailbox(
  deps: ManagementDeps,
  userId: string,
  options: { allowSuspended?: boolean } = {},
): Promise<MailboxRecord> {
  const mailbox = await deps.store.find(userId);
  if (mailbox === null || mailbox.status === "provisioning") throw notEnabled();
  if (mailbox.status === "erasing") throw mailboxErasing();
  if (mailbox.status === "suspended" && options.allowSuspended !== true) {
    throw notAllowed("the mailbox is suspended");
  }
  return mailbox;
}

/**
 * A 30-minute mail token for the proxy (BUILD.md section 4.3), naming the mailbox, the person and the
 * app that asked. The proxy then calls Stalwart as that mailbox, so the token can never reach another
 * one's mail.
 */
export async function mintMailSession(deps: ManagementDeps, caller: Caller): Promise<MailSession> {
  const mailbox = await activeMailbox(deps, caller.person.userId);
  const key = tokenKeyOf(deps.config);
  const minted = signMailToken(
    { mailboxId: mailbox.id, userId: mailbox.userId, app: caller.app },
    key,
  );
  return {
    token: minted.token,
    expiresAt: minted.expiresAt.toISOString(),
    // The same URLs the proxy mounts (spambank/proxy), from one helper.
    ...mailUrlsFor(deps.publicOrigin),
    address: addressOf(mailbox),
  };
}
