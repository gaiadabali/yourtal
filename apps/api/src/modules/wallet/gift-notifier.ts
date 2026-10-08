import { Inject, Injectable, Logger } from "@nestjs/common";
import type { OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { sql } from "drizzle-orm";
import type { VoucherGift } from "@yourtal/contracts/voucher-internal/gifts";
import { createSimulatedPush } from "@yourtal/drivers/push";
import type { AppDb } from "../../shared/persistence/drizzle-client";
import {
  VOUCHER_INTERNAL_CLIENT,
  type VoucherInternalClient,
} from "../../shared/voucher-client/voucher-internal-client";
import { GIFT_PARTY_READER, type GiftParty, type GiftPartyReader } from "./gift-party-reader";

export const GIFT_NOTIFIER_DB = Symbol("GIFT_NOTIFIER_DB");

type Kind = "gift_received" | "gift_returned";

/** Both locales. A received gift names the sender's display name only. */
const COPY: Record<
  GiftParty["displayLocale"],
  Record<Kind, (name: string, title: string) => [string, string]>
> = {
  "en-AU": {
    gift_received: (name, title) => [
      "You have a gift",
      `${name} sent you ${title}. Accept it in your wallet within 7 days.`,
    ],
    gift_returned: (_name, title) => [
      "Your gift came back",
      `${title} was not accepted, so it is back in your wallet with a new code.`,
    ],
  },
  "id-ID": {
    gift_received: (name, title) => [
      "Anda menerima hadiah",
      `${name} mengirimi Anda ${title}. Terima di dompet Anda dalam 7 hari.`,
    ],
    gift_returned: (_name, title) => [
      "Hadiah Anda kembali",
      `${title} tidak diterima, jadi kembali ke dompet Anda dengan kode baru.`,
    ],
  },
};

const SWEEP_MS = 60_000;

/**
 * 13.20.f (requested by B): a `me.notification` row, and a simulated push
 * where the person's preference allows it, when a gift arrives and when an
 * unaccepted one goes back. Teens neither send nor receive gifts, so no
 * quiet-hours rule is needed here. Also drives the voucher service's
 * return of gifts past their 7-day window, so each return is notified.
 */
@Injectable()
export class GiftNotifier implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(GiftNotifier.name);
  private readonly push = createSimulatedPush();
  private timer: NodeJS.Timeout | undefined;

  constructor(
    @Inject(GIFT_NOTIFIER_DB) private readonly db: AppDb,
    @Inject(GIFT_PARTY_READER) private readonly parties: GiftPartyReader,
    @Inject(VOUCHER_INTERNAL_CLIENT) private readonly vouchers: VoucherInternalClient,
  ) {}

  onModuleInit(): void {
    if (process.env["NODE_ENV"] === "test") return;
    // `sweep` never rejects, but a timer callback that did would take the process down.
    this.timer = setInterval(() => {
      this.sweep().catch((error: unknown) => {
        this.logger.warn(`gift sweep crashed: ${String(error)}`);
      });
    }, SWEEP_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer !== undefined) clearInterval(this.timer);
  }

  received(gift: VoucherGift): Promise<void> {
    return this.notify("gift_received", gift.recipientId, gift);
  }

  returned(gift: VoucherGift): Promise<void> {
    return this.notify("gift_returned", gift.senderId, gift);
  }

  /**
   * Returns every gift past its window, and tells each sender. Never throws:
   * the voucher service answering 500 (an unmapped status rejects the client
   * call rather than returning an error) just skips this run, and the next
   * tick sweeps again. A failure telling one sender is logged and the rest
   * still go. 13.3.u.
   */
  async sweep(): Promise<number> {
    let gifts: readonly VoucherGift[];
    try {
      const swept = await this.vouchers.sweepGifts();
      if (swept.isErr()) {
        this.logger.warn(`gift sweep failed: ${swept.error.code}`);
        return 0;
      }
      gifts = swept.value.gifts;
    } catch (error) {
      this.logger.warn(`gift sweep failed, will retry next run: ${String(error)}`);
      return 0;
    }
    for (const gift of gifts) {
      try {
        await this.returned(gift);
      } catch (error) {
        this.logger.warn(`gift ${gift.giftId} return notice failed: ${String(error)}`);
      }
    }
    return gifts.length;
  }

  private async notify(kind: Kind, userId: string, gift: VoucherGift): Promise<void> {
    try {
      const person = await this.parties.byUserId(userId);
      if (person === null) return;
      const sender = kind === "gift_received" ? await this.parties.byUserId(gift.senderId) : null;
      const [title, body] = COPY[person.displayLocale][kind](sender?.displayName ?? "", gift.title);
      // Once per gift and kind, even if a send is replayed.
      const inserted = await this.db.execute(sql`
        INSERT INTO me.notification (user_id, region, category, title, body, metadata)
        SELECT ${userId}, ${person.region}, ${kind}, ${title}, ${body},
               ${JSON.stringify({ giftId: gift.giftId, voucherId: gift.voucherId })}::jsonb
         WHERE NOT EXISTS (SELECT 1 FROM me.notification
                            WHERE user_id = ${userId} AND category = ${kind}
                              AND metadata->>'giftId' = ${gift.giftId})
      `);
      if (inserted.rowCount === 0) return;
      const { rows } = await this.db.execute<{ push_enabled: boolean }>(sql`
        SELECT push_enabled FROM me.notification_preference WHERE user_id = ${userId} AND category = ${kind}
      `);
      if (rows[0]?.push_enabled === false) return;
      const sent = await this.push.send({
        idempotencyKey: `${kind}:${gift.giftId}`,
        to: userId,
        region: person.region,
        category: kind,
        title,
        body,
      });
      if (sent.isErr()) this.logger.warn(`${kind} push not sent: ${sent.error.kind}`);
    } catch (error) {
      // Best effort: the gift itself already happened.
      this.logger.warn(`${kind} notification for ${gift.giftId} failed: ${String(error)}`);
    }
  }
}
