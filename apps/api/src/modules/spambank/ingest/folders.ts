import type { IngestEmail } from "./jmap-email";

/**
 * Which of a person's folders a message was delivered to (BUILD.md §4.2, B7). Stalwart's spam filter files
 * a message in the `junk`-role mailbox ("Spam"); the per-account Sieve rule files bulk mail in the custom
 * "Junk" mailbox whose id is stored on the mailbox row. Everything else (Sent, Drafts, Trash, anything the
 * person made) is `other`, and ingest does nothing with it.
 */
export type Folder = "inbox" | "spam" | "junk" | "other";

export interface MailboxFolders {
  readonly inboxId: string | null;
  readonly spamId: string | null;
  readonly junkId: string | null;
  /** The Inbox's unread count, when Stalwart said (`Mailbox/get` `unreadEmails`). */
  readonly unreadInbox: number | null;
}

interface RawMailbox {
  readonly id: string;
  readonly role: string | null;
  readonly name: string | null;
  readonly unreadEmails: number | null;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

/** Entries of a `Mailbox/get` `list`; anything that is not an object with an id is dropped. */
export function parseMailboxes(list: unknown): RawMailbox[] {
  if (!Array.isArray(list)) return [];
  const found: RawMailbox[] = [];
  for (const raw of list) {
    if (typeof raw !== "object" || raw === null) continue;
    const entry = raw as Record<string, unknown>;
    const id = str(entry["id"]);
    if (id === null) continue;
    const unread = entry["unreadEmails"];
    found.push({
      id,
      role: str(entry["role"]),
      name: str(entry["name"]),
      unreadEmails: typeof unread === "number" && Number.isFinite(unread) ? unread : null,
    });
  }
  return found;
}

/**
 * `storedJunkId` is `spambank.mailbox.junk_mailbox_id`. If it is missing (provisioning could not record
 * it), the custom mailbox is found by name: "Junk", or "Promotions" (the §4.2 fallback name).
 */
export function mailboxFolders(
  mailboxes: readonly RawMailbox[],
  storedJunkId: string | null,
): MailboxFolders {
  const inbox = mailboxes.find((m) => m.role === "inbox");
  const spam = mailboxes.find((m) => m.role === "junk");
  const junk =
    mailboxes.find((m) => m.id === storedJunkId) ??
    mailboxes.find(
      (m) => m.role === null && (m.name?.toLowerCase() === "junk" || m.name === "Promotions"),
    );
  return {
    inboxId: inbox?.id ?? null,
    spamId: spam?.id ?? null,
    junkId: junk?.id ?? null,
    unreadInbox: inbox?.unreadEmails ?? null,
  };
}

/** Spam wins over Inbox if a message is somehow in both; an unknown folder is `other`. */
export function folderOf(email: IngestEmail, folders: MailboxFolders): Folder {
  const inIds = (id: string | null): boolean => id !== null && email.mailboxIds[id] === true;
  if (inIds(folders.spamId)) return "spam";
  if (inIds(folders.inboxId)) return "inbox";
  if (inIds(folders.junkId)) return "junk";
  return "other";
}
