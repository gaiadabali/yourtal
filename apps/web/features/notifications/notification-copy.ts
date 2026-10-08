import type { Notification } from "@yourtal/contracts/me/notification";

export interface NotificationCopy {
  readonly title: string;
  readonly body: string;
}

/** The viewer's-language wording for the notifications that carry their facts in `metadata`. */
export interface CopyTools {
  readonly voucherExpiringTitle: string;
  voucherExpiringBody(reward: string, endsAt: Date): string;
}

/**
 * The worker stores English fallback text in each notification row. A voucher
 * warning carries its reward and end date in `metadata`, so it is worded here
 * in the viewer's own language; anything else shows the stored text.
 */
export function notificationCopy(notification: Notification, tools: CopyTools): NotificationCopy {
  const fallback = { title: notification.title, body: notification.body };
  if (notification.category !== "voucher_expiring") return fallback;
  const reward = notification.metadata?.["rewardTitle"];
  const endsAt = notification.metadata?.["expiresAt"];
  if (typeof reward !== "string" || typeof endsAt !== "string") return fallback;
  const date = new Date(endsAt);
  if (Number.isNaN(date.getTime())) return fallback;
  return {
    title: tools.voucherExpiringTitle,
    body: tools.voucherExpiringBody(reward, date),
  };
}
