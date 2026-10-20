import { sql } from "drizzle-orm";
import type { AppDb } from "../../shared/persistence/drizzle-client";
import type { Provider } from "./payment-accounts.repository";

export const PROVIDER_EVENTS = Symbol("PROVIDER_EVENTS");

/**
 * `payment.provider_event`, the webhook inbox. An event id is claimed before
 * any handler runs; `processed_at` is set only after all of them succeeded,
 * so a failed attempt leaves the claim open and the sender's retry runs again.
 */
export class ProviderEventRepository {
  constructor(private readonly db: AppDb) {}

  /** Claims the event; true when an earlier delivery already finished it. */
  async claim(eventId: string, provider: Provider, type: string): Promise<boolean> {
    await this.db.execute(sql`
      INSERT INTO payment.provider_event (event_id, provider, type)
      VALUES (${eventId}, ${provider}, ${type})
      ON CONFLICT (event_id) DO NOTHING`);
    const { rows } = await this.db.execute(
      sql`SELECT processed_at FROM payment.provider_event WHERE event_id = ${eventId}`,
    );
    return rows[0]?.["processed_at"] !== null && rows[0]?.["processed_at"] !== undefined;
  }

  async markProcessed(eventId: string): Promise<void> {
    await this.db.execute(sql`
      UPDATE payment.provider_event SET processed_at = now()
       WHERE event_id = ${eventId} AND processed_at IS NULL`);
  }
}
