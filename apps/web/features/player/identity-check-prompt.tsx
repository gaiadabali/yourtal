"use client";

import Link from "next/link";
import type { Route } from "next";
import { usePathname } from "next/navigation";
import { useState, useTransition } from "react";
import type { IdentityCheckStep } from "@yourtal/contracts/identity/earning-check";
import { Button } from "@yourtal/ui/button";
import { requestEmailVerificationAction } from "./identity-check-actions";
import { getPlayerTranslator, type SupportedLocale } from "./player-i18n";

export interface IdentityCheckPromptProps {
  /** What the server said is still missing (`identityCheck.missing`); both when it did not say. */
  missing: readonly IdentityCheckStep[];
  locale: SupportedLocale;
}

const BOTH_STEPS: readonly IdentityCheckStep[] = ["verify_email", "add_passkey"];

/**
 * F126: "Verify your email and add a passkey to start earning", with a way to
 * each. The email step sends the verification link again; the passkey step is
 * the existing passkey screen, which comes back here when done.
 */
export function IdentityCheckPrompt({ missing, locale }: IdentityCheckPromptProps) {
  const t = getPlayerTranslator(locale);
  const pathname = usePathname();
  const [email, setEmail] = useState<"idle" | "sent" | "failed">("idle");
  const [isPending, startTransition] = useTransition();
  const steps = missing.length === 0 ? BOTH_STEPS : missing;

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
        {steps.includes("add_passkey") ? (
          <Button asChild size="sm" variant="secondary">
            <Link href={`/passkey?returnTo=${encodeURIComponent(pathname)}` as Route}>
              {t("identityCheck.addPasskeyCta")}
            </Link>
          </Button>
        ) : null}
      </div>
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
