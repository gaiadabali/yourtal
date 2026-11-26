import { randomUUID } from "node:crypto";
import type {
  InsertOutcome,
  MailboxRecord,
  MailboxStore,
  NewMailbox,
} from "../persistence/mailbox.store";

/**
 * `MailboxStore` in memory, for the use-case tests: the same rules as the table (one mailbox per
 * person, a unique name, retired names refused) without a database. A person's lock is a queue, so
 * two overlapping calls run one after the other, as the advisory lock makes them.
 */
export class MemoryMailboxStore implements MailboxStore {
  readonly rows = new Map<string, MailboxRecord>();
  readonly retired = new Set<string>();
  private readonly chains = new Map<string, Promise<unknown>>();

  find(userId: string): Promise<MailboxRecord | null> {
    return Promise.resolve(this.byUser(userId) ?? null);
  }

  private byUser(userId: string): MailboxRecord | undefined {
    return [...this.rows.values()].find((row) => row.userId === userId);
  }

  insertProvisioning(input: NewMailbox): Promise<InsertOutcome> {
    const own = this.byUser(input.userId);
    if (own !== undefined) return Promise.resolve({ kind: "user_exists", mailbox: own });
    const taken =
      this.retired.has(input.localPart) ||
      [...this.rows.values()].some((row) => row.localPart === input.localPart);
    if (taken) return Promise.resolve({ kind: "name_taken" });
    const mailbox: MailboxRecord = {
      id: randomUUID(),
      userId: input.userId,
      region: input.region,
      localPart: input.localPart,
      domain: input.domain,
      stalwartAccountId: null,
      junkMailboxId: null,
      status: "provisioning",
      enabledVia: input.enabledVia,
      statementsToSnapapp: false,
      newMailAlerts: true,
      emailState: null,
      createdAt: new Date("2026-11-28T01:00:00Z"),
    };
    this.rows.set(mailbox.id, mailbox);
    return Promise.resolve({ kind: "inserted", mailbox });
  }

  private update(id: string, change: Partial<MailboxRecord>): MailboxRecord | null {
    const row = this.rows.get(id);
    if (row === undefined) return null;
    const next = { ...row, ...change };
    this.rows.set(id, next);
    return next;
  }

  setStalwartAccount(id: string, accountId: string): Promise<void> {
    this.update(id, { stalwartAccountId: accountId });
    return Promise.resolve();
  }

  activate(
    id: string,
    input: { junkMailboxId: string | null; emailState: string | null },
  ): Promise<MailboxRecord | null> {
    const row = this.rows.get(id);
    if (row?.status !== "provisioning") return Promise.resolve(null);
    return Promise.resolve(this.update(id, { status: "active", ...input }));
  }

  discardProvisioning(id: string, localPart: string, retire: boolean): Promise<void> {
    if (retire) this.retired.add(localPart);
    if (this.rows.get(id)?.status === "provisioning") this.rows.delete(id);
    return Promise.resolve();
  }

  updateSettings(
    id: string,
    patch: { statementsToSnapapp?: boolean; newMailAlerts?: boolean },
  ): Promise<MailboxRecord | null> {
    const row = this.rows.get(id);
    if (row === undefined || (row.status !== "active" && row.status !== "suspended")) {
      return Promise.resolve(null);
    }
    return Promise.resolve(this.update(id, patch));
  }

  erase(userId: string): Promise<number> {
    const row = this.byUser(userId);
    if (row === undefined) return Promise.resolve(0);
    this.retired.add(row.localPart);
    this.update(row.id, { status: "erasing" });
    return Promise.resolve(1);
  }

  removeErasing(id: string): Promise<void> {
    if (this.rows.get(id)?.status === "erasing") this.rows.delete(id);
    return Promise.resolve();
  }

  withUserLock<T>(userId: string, work: () => Promise<T>): Promise<T> {
    const previous = this.chains.get(userId) ?? Promise.resolve();
    const run = previous.then(work, work);
    this.chains.set(
      userId,
      run.then(
        () => undefined,
        () => undefined,
      ),
    );
    return run;
  }
}
