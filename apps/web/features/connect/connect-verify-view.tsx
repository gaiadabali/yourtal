"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { InteractionDetails } from "@yourtal/contracts/oidc/interaction";
import { Button } from "@yourtal/ui/button";
import { Notice } from "@yourtal/ui/notice";
import { Text } from "@yourtal/ui/text";
import { AuthCard } from "@/features/auth/auth-card";
import { AccountLine } from "./account-line";
import { resendVerificationAction } from "./connect-actions";
import type { ResendResult } from "./connect-actions";
import { useConnectAction } from "./use-connect-action";

export interface ConnectVerifyViewProps {
  details: InteractionDetails;
}

/** `verify_email`: signed in, but the email is not confirmed yet. */
export function ConnectVerifyView({ details }: ConnectVerifyViewProps) {
  const t = useTranslations("connect.verify");
  const router = useRouter();
  const { busy, run } = useConnectAction();
  const [checking, startChecking] = useTransition();
  const [resending, setResending] = useState(false);
  const [resend, setResend] = useState<ResendResult | null>(null);
  const email = details.account?.email ?? "";

  async function sendAgain(): Promise<void> {
    setResending(true);
    let result: ResendResult;
    try {
      result = await resendVerificationAction();
    } catch {
      result = { kind: "error" };
    }
    if (result.kind === "reload") router.refresh();
    else setResend(result);
    setResending(false);
  }

  return (
    <AuthCard title={t("heading")} description={t("intro", { email, app: details.client.name })}>
      {/* The emailed link opens the verify page; once it is confirmed, reloading shows the next screen. */}
      <Button
        type="button"
        disabled={checking || busy}
        onClick={() => startChecking(() => router.refresh())}
      >
        {t("doneCta")}
      </Button>
      <Text tone="muted" size="body-sm">
        {t("resendPrompt")}
      </Text>
      <Button
        type="button"
        variant="secondary"
        disabled={resending || busy}
        onClick={() => void sendAgain()}
      >
        {t("resendCta")}
      </Button>
      {resend?.kind === "sent" ? <Notice tone="success">{t("resent", { email })}</Notice> : null}
      {resend?.kind === "throttled" ? <Notice tone="warning">{t("resendThrottled")}</Notice> : null}
      {resend?.kind === "error" ? <Notice tone="danger">{t("resendFailed")}</Notice> : null}
      {details.account ? <AccountLine email={email} disabled={busy} run={run} /> : null}
    </AuthCard>
  );
}
