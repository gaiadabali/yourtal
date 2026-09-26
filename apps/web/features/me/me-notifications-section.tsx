"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Section } from "@yourtal/ui/section";
import { Switch } from "@yourtal/ui/switch";
import { Text } from "@yourtal/ui/text";
import { setNotificationPreferenceAction } from "./me-actions";
import { useMeActionStatus } from "./use-me-action-status";

export interface MeNotificationsSectionProps {
  initialPreferences: Readonly<Record<string, boolean>>;
}

const POINTS_UNLOCKED_CATEGORY = "points_unlocked";

/**
 * `GET`/`PUT /api/me/notifications/preferences/:category` (5.5.b). Only
 * `points_unlocked` is wired end to end today (a real
 * `ledger.points_unlocked` worker job) — `points_expiring` and
 * followed-channel campaigns have no source event yet (⛔ 10.2/7.3.f per
 * TASKS.md 5.5.b), so this section shows only the one real category rather
 * than a toggle for something that can never fire.
 */
export function MeNotificationsSection({ initialPreferences }: MeNotificationsSectionProps) {
  const t = useTranslations("me.notifications");
  const [preferences, setPreferences] =
    useState<Readonly<Record<string, boolean>>>(initialPreferences);
  const { status, run } = useMeActionStatus();

  // No row means enabled — same "no row = default" convention
  // `notification.repository.ts`'s own comment documents.
  const pointsUnlockedEnabled = preferences[POINTS_UNLOCKED_CATEGORY] ?? true;

  function toggle(checked: boolean) {
    run(
      () => setNotificationPreferenceAction(POINTS_UNLOCKED_CATEGORY, checked),
      (data) => setPreferences(data.preferences),
    );
  }

  return (
    <Section title={t("heading")} description={t("intro")}>
      <div className="flex items-start justify-between gap-4 rounded-card border border-border-subtle bg-surface p-4">
        <div className="flex flex-col gap-1">
          <Text size="label" as="label">
            {t("pointsUnlockedTitle")}
          </Text>
          <Text size="body-sm" tone="muted">
            {t("pointsUnlockedBody")}
          </Text>
        </div>
        <Switch
          label={t("pointsUnlockedTitle")}
          hideLabel
          checked={pointsUnlockedEnabled}
          onCheckedChange={toggle}
        />
      </div>
      {status.kind === "error" ? (
        <Text size="body-sm" tone="danger" role="alert">
          {status.message}
        </Text>
      ) : null}
    </Section>
  );
}
