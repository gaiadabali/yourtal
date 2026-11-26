/**
 * Open EventSource streams per mailbox (spambank/BUILD.md §4.3): at most 3 at once, each closed by
 * the server after 25 minutes so a stream never outlives the token that opened it by long. Counted
 * in this process: the API runs as one pm2 process (infra/helios/ecosystem.config.cjs); a second
 * instance would need the count in Valkey.
 */

export const MAX_STREAMS_PER_MAILBOX = 3;
export const STREAM_LIFETIME_MS = 25 * 60_000;

export interface StreamSlot {
  release(): void;
}

export interface EventStreams {
  /** A slot for one more stream, or undefined when the mailbox already has its three. */
  open(mailboxId: string): StreamSlot | undefined;
  count(mailboxId: string): number;
}

export function createEventStreams(max = MAX_STREAMS_PER_MAILBOX): EventStreams {
  const open = new Map<string, number>();
  return {
    count: (id) => open.get(id) ?? 0,
    open(id) {
      const current = open.get(id) ?? 0;
      if (current >= max) return undefined;
      open.set(id, current + 1);
      let released = false;
      return {
        release() {
          if (released) return;
          released = true;
          const left = (open.get(id) ?? 1) - 1;
          if (left <= 0) open.delete(id);
          else open.set(id, left);
        },
      };
    },
  };
}
