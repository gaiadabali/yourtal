"use client";

import { useState, useTransition } from "react";
import type { IdentityCheckStep } from "@yourtal/contracts/identity/earning-check";
import { Button } from "@yourtal/ui/button";
import { requestEmailVerificationAction } from "./identity-check-actions";
import { getPlayerTranslator, type SupportedLocale } from "./player-i18n";

export interface IdentityCheckPromptProps {
  /** What the server said is still missing (`identityCheck.missing`); the email step when it did not say. */
  missing: readonly IdentityCheckStep[];
  locale: SupportedLocale;
}

const UNKNOWN_STEPS: readonly IdentityCheckStep[] = ["verify_email"];

/**
 * F126: the way forward for an account that may not earn yet. A verification
 * step gets the button that sends the link again. A disposable address gets
 * a plain line and no link, because YourTal has no change-email flow yet.
 */
export function IdentityCheckPrompt({ missing, locale }: IdentityCheckPromptProps) {
  const t = getPlayerTranslator(locale);
  const [email, setEmail] = useState<"idle" | "sent" | "failed">("idle");
  const [isPending, startTransition] = useTransition();
  const steps = missing.length === 0 ? UNKNOWN_STEPS : missing;

  function sendEmail() {
    startTransition(async () => {
      const sent = await requestEmailVerificationAction();
      setEmail(sent.ok ? "sent" : "failed");
    });
  }

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="flex flex-wrap justify-center gap-2">
        {steps.includes("verify_email") && email !== "sent" ? (
          <Button type="button" size="sm" onClick={sendEmail} loading={isPending}>
            {t("identityCheck.verifyEmailCta")}
          </Button>
        ) : null}
      </div>
      {steps.includes("use_permanent_email") ? (
        <p className="text-sm font-sans">{t("identityCheck.usePermanentEmail")}</p>
      ) : null}
      {email === "sent" ? (
        <p role="status" className="text-sm font-sans">
          {t("identityCheck.verifyEmailSent")}
        </p>
      ) : null}
      {email === "failed" ? (
        <p role="alert" className="text-sm font-sans">
          {t("identityCheck.verifyEmailFailed")}
        </p>
      ) : null}
    </div>
  );
}
