"use client";

import { useEffect } from "react";
import { useTranslations } from "next-intl";
import { Heading } from "@yourtal/ui/heading";
import { Text } from "@yourtal/ui/text";
import { Button } from "@yourtal/ui/button";

export interface OnboardingErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

/** Error boundary for the whole `/onboarding` flow. See `app/(app)/error.tsx` for the same pattern. */
export default function OnboardingError({ error, reset }: OnboardingErrorProps) {
  const t = useTranslations("onboarding.boundary");
  useEffect(() => {
    console.error("Onboarding failed to load:", error);
  }, [error]);

  return (
    <div className="flex flex-col items-center gap-3 p-10 text-center">
      <Heading level={1} size="title">
        {t("title")}
      </Heading>
      <Text tone="muted">{t("body")}</Text>
      <Button onClick={reset}>{t("retryCta")}</Button>
    </div>
  );
}
