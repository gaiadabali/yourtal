import type { MailboxRecord } from "../persistence/mailbox.store";
import type { ManagementDeps } from "./deps";
import { mailboxErasing, noSetting, notEnabled } from "./errors";
import { activeMailbox } from "./session";

/**
 * The settings SnapApp owns (spambank/BUILD.md section 5.2 `/settings`): whether mailed statements are
 * offered to it, and whether it is told about new mail. Only SnapApp's own server may call this; the
 * controller checks the sector before it gets here.
 */
export async function updateSettings(
  deps: ManagementDeps,
  userId: string,
  patch: { statementsToSnapApp?: boolean | undefined; newMailAlerts?: boolean | undefined },
): Promise<MailboxRecord> {
  if (patch.statementsToSnapApp === undefined && patch.newMailAlerts === undefined) {
    throw noSetting();
  }
  const mailbox = await activeMailbox(deps, userId, { allowSuspended: true });
  const changed = await deps.store.updateSettings(mailbox.id, {
    ...(patch.statementsToSnapApp === undefined
      ? {}
      : { statementsToSnapapp: patch.statementsToSnapApp }),
    ...(patch.newMailAlerts === undefined ? {} : { newMailAlerts: patch.newMailAlerts }),
  });
  if (changed === null) throw mailbox.status === "erasing" ? mailboxErasing() : notEnabled();
  return changed;
}
