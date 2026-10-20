import type { PaymentEvent } from "@yourtal/drivers/payments";

export const PAYMENT_EVENT_HANDLERS = Symbol("PAYMENT_EVENT_HANDLERS");

type EventOf<T extends PaymentEvent["type"]> = Extract<PaymentEvent, { type: T }>;
type Handler = (event: PaymentEvent) => Promise<void>;

/**
 * Where billing (and later auctions and payouts) subscribe to verified
 * payment events. Every handler must be idempotent and must ignore an event
 * that is not its own: one event reaches every handler of its type, and a
 * delivery can arrive more than once.
 */
export class PaymentEventHandlers {
  private readonly byType = new Map<PaymentEvent["type"], Handler[]>();

  on<T extends PaymentEvent["type"]>(type: T, handler: (event: EventOf<T>) => Promise<void>): void {
    const list = this.byType.get(type) ?? [];
    list.push(handler as Handler);
    this.byType.set(type, list);
  }

  /** Runs every handler of the event's type in turn; the first failure rejects, so the sender retries. */
  async dispatch(event: PaymentEvent): Promise<number> {
    const handlers = this.byType.get(event.type) ?? [];
    for (const handler of handlers) await handler(event);
    return handlers.length;
  }
}

/** Our id from a reference like `card-purchase:<uuid>`, when it is one of ours and well formed. */
export function referenceId(reference: string | null, prefix: string): string | null {
  if (reference === null || !reference.startsWith(`${prefix}:`)) return null;
  const id = reference.slice(prefix.length + 1);
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) ? id : null;
}
