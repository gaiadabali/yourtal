"use client";

import { useTranslations } from "next-intl";
import { GOD_GROUP_NOTICE } from "@yourtal/consent/god-group-notice-constants";
import { Text } from "@yourtal/ui/text";

const BULLETS = ["bullet1", "bullet2", "bullet3", "bullet4", "bullet5", "bullet6"] as const;

/** What GOD means for a teen (god/TASKS.md 9.1.c), in the founder's fixed words. */
export function GodTeenExplanation() {
  const t = useTranslations("godNotice.teen");
  const tick = useTranslations("godNotice.tick");
  return (
    <div className="flex flex-col gap-2">
      <Text size="label">{t("heading")}</Text>
      <ul className="flex list-disc flex-col gap-1.5 pl-5 text-body-sm text-fg-muted">
        {BULLETS.map((key) => (
          <li key={key}>{t(key)}</li>
        ))}
      </ul>
      <a
        href={GOD_GROUP_NOTICE.teensUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="self-start text-body-sm text-accent underline underline-offset-4"
      >
        {tick("link")}
      </a>
    </div>
  );
}
