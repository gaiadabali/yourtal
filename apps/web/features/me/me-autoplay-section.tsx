"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import type { AutoplaySetting } from "@yourtal/contracts/me/autoplay-setting";
import { Section } from "@yourtal/ui/section";
import { SegmentedControl } from "@yourtal/ui/segmented-control";
import { Text } from "@yourtal/ui/text";
import { setAutoplayAction } from "./me-actions";
import { useMeActionStatus } from "./use-me-action-status";

export interface MeAutoplaySectionProps {
  initialAutoplay: AutoplaySetting;
}

/**
 * TASKS.md 6.7.a/6.7.b: Always / Wi-Fi only / Never, saved immediately on
 * change (no separate submit — a three-way preference is exactly what
 * `SegmentedControl`'s radiogroup pattern is for). 6.3's feed (not built
 * yet) reads the SAME value back through `AutoplaySettingReader`
 * (`apps/api/src/modules/me/persistence/viewer-setting.repository.ts`) —
 * this widget only ever writes `GET`/`PUT /api/me/settings/autoplay`.
 */
export function MeAutoplaySection({ initialAutoplay }: MeAutoplaySectionProps) {
  const t = useTranslations("me.autoplay");
  const [autoplay, setAutoplay] = useState<AutoplaySetting>(initialAutoplay);
  const { status, run } = useMeActionStatus();

  function handleChange(next: AutoplaySetting) {
    setAutoplay(next);
    run(
      () => setAutoplayAction(next),
      (data) => setAutoplay(data.autoplay),
    );
  }

  return (
    <Section title={t("heading")} description={t("intro")}>
      <SegmentedControl
        label={t("heading")}
        value={autoplay}
        onChange={handleChange}
        options={[
          { value: "always", label: t("always") },
          { value: "wifi_only", label: t("wifiOnly") },
          { value: "never", label: t("never") },
        ]}
      />
      {status.kind === "error" ? (
        <Text size="body-sm" tone="danger" role="alert">
          {status.message}
        </Text>
      ) : null}
    </Section>
  );
}
