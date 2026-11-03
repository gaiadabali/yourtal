"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Section } from "@yourtal/ui/section";
import { Badge } from "@yourtal/ui/badge";
import { Button } from "@yourtal/ui/button";
import { Notice } from "@yourtal/ui/notice";
import { Text } from "@yourtal/ui/text";
import { requestEmailVerificationAction } from "@/features/player/identity-check-actions";

export interface EmailVerificationProps {
  email: string;
  verified: boolean;
}

type SendState = "idle" | "sent" | "failed";

/** The resend button and its outcome, shared by the Me status card and the post-sign-up reminder. */
function useResend() {
  const [state, setState] = useState<SendState>("idle");
  const [isPending, startTransition] = useTransition();
  function send() {
    startTransition(async () => {
      const result = await requestEmailVerificationAction();
      setState(result.ok ? "sent" : "failed");
    });
  }
  return { state, isPending, send };
}

/**
 * Me's email status (F126: points need a verified email). Verified shows a plain confirmation; not
 * verified shows what to do and a button that sends the link again.
 */
export function MeEmailVerificationSection({ email, verified }: EmailVerificationProps) {
  const t = useTranslations("me.emailVerification");
  const { state, isPending, send } = useResend();

  return (
    <Section title={t("heading")} description={t("intro")}>
      <div className="flex flex-wrap items-center gap-2">
        <Text size="body-sm">{email}</Text>
        <Badge variant={verified ? "success" : "warning"}>
          {verified ? t("statusVerified") : t("statusUnverified")}
        </Badge>
      </div>
      {verified ? (
        <Text size="body-sm" tone="muted">
          {t("verifiedBody")}
        </Text>
      ) : (
        <div className="flex flex-col gap-3">
          <Text size="body-sm" tone="muted">
            {t("unverifiedBody")}
          </Text>
          {state === "sent" ? (
            <Notice tone="success">{t("sent", { email })}</Notice>
          ) : (
            <Button type="button" onClick={send} loading={isPending} className="self-start">
              {t("resendCta")}
            </Button>
          )}
          {state === "failed" ? <Notice tone="danger">{t("failed")}</Notice> : null}
        </div>
      )}
    </Section>
  );
}

/** A light prompt for someone who has just signed up and has not verified yet. */
export function EmailVerificationReminder({ email }: { email: string }) {
  const t = useTranslations("me.emailVerification");
  const { state, isPending, send } = useResend();

  return (
    <Notice
      tone="warning"
      title={t("reminderTitle")}
      action={
        state === "sent" ? null : (
          <Button type="button" size="sm" variant="secondary" onClick={send} loading={isPending}>
            {t("resendCta")}
          </Button>
        )
      }
    >
      <p>{state === "sent" ? t("sent", { email }) : t("reminderBody", { email })}</p>
      {state === "failed" ? <p>{t("failed")}</p> : null}
    </Notice>
  );
}
