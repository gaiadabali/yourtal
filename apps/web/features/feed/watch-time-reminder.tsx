"use client";

import { useTranslations } from "next-intl";
import { Button } from "@yourtal/ui/button";
import { Text } from "@yourtal/ui/text";

export interface WatchTimeReminderProps {
  onDismiss: () => void;
}

/**
 * 12.2.b's gentle, non-blocking watch-time nudge — `role="status"` (polite,
 * not `alert`: nothing urgent, nothing that should interrupt), and
 * dismissing it never pauses or stops the video underneath. Warm copy only:
 * no streak-loss framing, no "you should stop" — just a reminder that a
 * break exists.
 */
export function WatchTimeReminder({ onDismiss }: WatchTimeReminderProps) {
  const t = useTranslations("feed");
  return (
    <div
      role="status"
      className="flex items-center justify-between gap-3 rounded-card bg-surface-sunken px-4 py-3"
    >
      <Text size="body-sm">{t("watchTimeReminder.body")}</Text>
      <Button size="sm" variant="secondary" onClick={onDismiss}>
        {t("watchTimeReminder.dismiss")}
      </Button>
    </div>
  );
}
