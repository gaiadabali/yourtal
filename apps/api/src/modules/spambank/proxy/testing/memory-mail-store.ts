import type {
  MailCounters,
  MailboxRecord,
  SpambankMailStore,
  UnsubscribeRecord,
} from "../mail-store";

/** An in-memory `SpambankMailStore` for the mail API's tests (the Postgres one has its own e2e test). */
export class MemoryMailStore implements SpambankMailStore {
  readonly mailboxes = new Map<string, MailboxRecord>();
  readonly sent = new Map<string, number>();
  readonly unsubscribes: UnsubscribeRecord[] = [];
  counterValues: MailCounters = {
    bulkFiled30d: 4,
    marketersUnsubscribed: 2,
    autoRepliesSent30d: 1,
  };
  readonly day = "2026-11-28";

  findMailbox(id: string): Promise<MailboxRecord | undefined> {
    return Promise.resolve(this.mailboxes.get(id));
  }

  reserveRecipients(mailboxId: string, count: number, cap: number): Promise<string | undefined> {
    const now = this.sent.get(mailboxId) ?? 0;
    if (now + count > cap) return Promise.resolve(undefined);
    this.sent.set(mailboxId, now + count);
    return Promise.resolve(this.day);
  }

  releaseRecipients(mailboxId: string, _day: string, count: number): Promise<void> {
    this.sent.set(mailboxId, Math.max((this.sent.get(mailboxId) ?? 0) - count, 0));
    return Promise.resolve();
  }

  recordUnsubscribe(row: UnsubscribeRecord): Promise<void> {
    this.unsubscribes.push(row);
    return Promise.resolve();
  }

  counters(): Promise<MailCounters> {
    return Promise.resolve(this.counterValues);
  }
}
