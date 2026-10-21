"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Button } from "@yourtal/ui/button";
import { Text } from "@yourtal/ui/text";
import { AuthCard } from "@/features/auth/auth-card";

/** The sign-in has ended, or belongs to another browser (404). There is nothing to do here but go back to the app. */
export function ConnectEndedView() {
  const t = useTranslations("connect.ended");
  return (
    <AuthCard title={t("heading")}>
      <Text>{t("body")}</Text>
    </AuthCard>
  );
}

/** The API could not be reached or answered something unexpected. Trying again reloads the details. */
export function ConnectUnavailableView() {
  const t = useTranslations("connect.unavailable");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <AuthCard title={t("heading")}>
      <Text>{t("body")}</Text>
      <Button
        type="button"
        disabled={pending}
        onClick={() => startTransition(() => router.refresh())}
      >
        {t("retryCta")}
      </Button>
    </AuthCard>
  );
}
