/** A raw `pg.Pool` for the management API's own SQL (the mailbox store and the sub lookup). */
export const SPAMBANK_PG_POOL = Symbol("SPAMBANK_PG_POOL");
/** Holds a person's advisory lock while their work runs (see `createPgMailboxStore`). */
export const SPAMBANK_LOCK_POOL = Symbol("SPAMBANK_LOCK_POOL");
export const SPAMBANK_MAILBOX_STORE = Symbol("SPAMBANK_MAILBOX_STORE");
