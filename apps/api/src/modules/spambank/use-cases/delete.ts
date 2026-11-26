import type { ManagementDeps } from "./deps";
import { notEnabled } from "./errors";

/**
 * "Delete my mailbox only" (spambank/BUILD.md section 4.11, `DELETE /api/spambank/me`): the YourTal
 * account stays. It runs the same erasure as an account deletion: the row goes `erasing`, the name is
 * retired for good, what the service learned from the mail is deleted. Then, best effort, the Stalwart
 * account is destroyed straight away so the mailbox is usually gone before the answer is read; if
 * that fails, the worker's `spambank-erase-sweep` finishes it within minutes.
 */
export async function deleteMailbox(deps: ManagementDeps, userId: string): Promise<void> {
  const { store, driver } = deps;
  const mailbox = await store.withUserLock(userId, async () => {
    const found = await store.find(userId);
    if (found === null) throw notEnabled();
    await store.erase(userId);
    return found;
  });
  if (mailbox.stalwartAccountId === null) {
    await store.removeErasing(mailbox.id);
    return;
  }
  const destroyed = await driver.destroyAccount(mailbox.stalwartAccountId);
  if (destroyed.isOk()) {
    await store.removeErasing(mailbox.id);
    return;
  }
  deps.log.warn(
    `spambank delete: could not destroy the account yet (${destroyed.error.code}); the sweep will`,
  );
}
