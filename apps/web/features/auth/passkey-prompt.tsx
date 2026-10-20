"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Route } from "next";
import { useTranslations } from "next-intl";
import { Button } from "@yourtal/ui/button";
import { Notice } from "@yourtal/ui/notice";
import { authErrorMessage } from "@/features/auth/auth-error-copy";
import {
  passkeyApiCode,
  runRegistration,
  useBrowserSupportsWebAuthn,
} from "@/features/auth/passkey-ceremony";
import {
  registerPasskeyAction,
  registerPasskeyOptionsAction,
} from "@/features/me/sign-in-methods-actions";

export interface PasskeyPromptProps {
  returnTo: string;
}

/**
 * The two buttons under the "Add a passkey?" offer. A failed or cancelled
 * attempt keeps the person here, with the message, to try again or move on;
 * a browser without WebAuthn is only offered the way on.
 */
export function PasskeyPrompt({ returnTo }: PasskeyPromptProps) {
  const t = useTranslations("auth.passkeyPrompt");
  const router = useRouter();
  const supported = useBrowserSupportsWebAuthn();
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const goOn = () => router.push(returnTo as Route);

  function handleAdd() {
    setErrorCode(null);
    startTransition(async () => {
      const ceremony = await runRegistration(registerPasskeyOptionsAction);
      if (!ceremony.ok) {
        setErrorCode(ceremony.code);
        return;
      }
      const saved = await registerPasskeyAction(ceremony.data.response);
      if (!saved.ok) {
        setErrorCode(
          passkeyApiCode(saved.error.kind === "http" ? saved.error.code : saved.error.kind),
        );
        return;
      }
      goOn();
    });
  }

  return (
    <div className="flex flex-col gap-3">
      {errorCode ? <Notice tone="danger">{authErrorMessage(t, errorCode)}</Notice> : null}
      {supported ? (
        <>
          <Button type="button" onClick={handleAdd} disabled={isPending}>
            {t("addCta")}
          </Button>
          <Button type="button" variant="secondary" onClick={goOn} disabled={isPending}>
            {t("notNowCta")}
          </Button>
        </>
      ) : (
        <Button type="button" onClick={goOn}>
          {t("continueCta")}
        </Button>
      )}
    </div>
  );
}
