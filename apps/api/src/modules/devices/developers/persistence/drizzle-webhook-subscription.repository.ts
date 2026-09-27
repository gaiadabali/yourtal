import { eq } from "drizzle-orm";
import type { AppDb } from "../../../../shared/persistence/drizzle-client";
import { webhookSubscriptions } from "../schema/webhook-subscription.table";
import type {
  WebhookSubscriptionRepository,
  WebhookSubscriptionRow,
} from "./webhook-subscription.repository";

export class DrizzleWebhookSubscriptionRepository implements WebhookSubscriptionRepository {
  constructor(private readonly db: AppDb) {}

  async upsert(
    businessId: string,
    url: string,
    sealed: { readonly ciphertext: Buffer; readonly nonce: Buffer },
  ): Promise<WebhookSubscriptionRow> {
    const [row] = await this.db
      .insert(webhookSubscriptions)
      .values({
        businessId,
        url,
        secretCiphertext: sealed.ciphertext,
        secretNonce: sealed.nonce,
      })
      .onConflictDoUpdate({
        target: webhookSubscriptions.businessId,
        set: { url, secretCiphertext: sealed.ciphertext, secretNonce: sealed.nonce },
      })
      .returning();
    if (row === undefined) {
      throw new Error("upsert into business.webhook_subscription returned no row");
    }
    return row;
  }

  async findByBusinessId(businessId: string): Promise<WebhookSubscriptionRow | null> {
    const [row] = await this.db
      .select()
      .from(webhookSubscriptions)
      .where(eq(webhookSubscriptions.businessId, businessId))
      .limit(1);
    return row ?? null;
  }
}
