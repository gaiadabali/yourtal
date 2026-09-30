"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import type { ThemeSetting } from "@yourtal/contracts/me/theme-setting";
import { Section } from "@yourtal/ui/section";
import { SegmentedControl } from "@yourtal/ui/segmented-control";
import { Text } from "@yourtal/ui/text";
import { setThemeAction } from "./me-actions";

export interface MeThemeSectionProps {
  initialTheme: ThemeSetting;
}

/** 13.16.a: the same setting as the header menu's, saved to the account and the cookie. */
export function MeThemeSection({ initialTheme }: MeThemeSectionProps) {
  const t = useTranslations("me.theme");
  const [theme, setTheme] = useState<ThemeSetting>(initialTheme);
  const [failed, setFailed] = useState(false);
  const [, startTransition] = useTransition();
  const router = useRouter();

  function handleChange(next: ThemeSetting) {
    const previous = theme;
    setTheme(next);
    setFailed(false);
    startTransition(async () => {
      const result = await setThemeAction(next);
      if (!result.ok) {
        setTheme(previous);
        setFailed(true);
        return;
      }
      router.refresh();
    });
  }

  return (
    <Section title={t("heading")} description={t("intro")}>
      <SegmentedControl
        label={t("heading")}
        value={theme}
        onChange={handleChange}
        options={[
          { value: "system", label: t("system") },
          { value: "light", label: t("light") },
          { value: "dark", label: t("dark") },
        ]}
      />
      {failed ? (
        <Text size="body-sm" tone="danger" role="alert">
          {t("saveFailed")}
        </Text>
      ) : null}
    </Section>
  );
}
