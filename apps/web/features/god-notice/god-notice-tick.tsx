"use client";

import { useTranslations } from "next-intl";
import { GOD_GROUP_NOTICE } from "@yourtal/consent/god-group-notice-constants";

export interface GodNoticeTickProps {
  /** Set for a plain `<form>` (registration); left out when the caller holds the state. */
  readonly name?: string;
  readonly checked?: boolean;
  readonly onCheckedChange?: (checked: boolean) => void;
  readonly required?: boolean;
}

/**
 * The adult GOD Group Privacy Notice tick box (god/TASKS.md 9.1.b), unticked
 * by default. The wording is fixed by the founder and identical in the three
 * apps; "GOD Group Privacy Notice" opens the notice in a new tab.
 */
export function GodNoticeTick({ name, checked, onCheckedChange, required }: GodNoticeTickProps) {
  const t = useTranslations("godNotice.tick");
  return (
    <label className="flex items-start gap-2 text-body-sm text-fg">
      <input
        type="checkbox"
        {...(name === undefined ? {} : { name })}
        {...(checked === undefined ? {} : { checked })}
        {...(onCheckedChange === undefined
          ? {}
          : {
              onChange: (event: React.ChangeEvent<HTMLInputElement>) =>
                onCheckedChange(event.target.checked),
            })}
        required={required}
        className="mt-1 shrink-0"
      />
      <span>
        {t("before")}{" "}
        <a
          href={GOD_GROUP_NOTICE.url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-accent-text underline underline-offset-4"
        >
          {t("link")}
        </a>
        {t("after")}
      </span>
    </label>
  );
}
