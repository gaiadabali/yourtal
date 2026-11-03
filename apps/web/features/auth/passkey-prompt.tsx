"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
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
  usePlatformAuthenticator,
} from "@/features/auth/passkey-ceremony";
import {
  registerPasskeyAction,
  registerPasskeyOptionsAction,
} from "@/features/me/sign-in-methods-actions";

export interface PasskeyPromptProps {
  returnTo: string;
  /** `earn`: the player was sent here because earning needs a passkey, so the way on is a way back, never a skip. */
  reason?: "earn" | undefined;
}

/**
 * The two buttons under the "Add a passkey?" offer. A failed or cancelled
 * attempt keeps the person here, with the message, to try again or move on.
 * A browser without WebAuthn is only offered the way on, or, when earning
 * needs the passkey, told to add one from another device. A browser with
 * WebAuthn but no built-in authenticator still gets the button: the browser
 * offers a phone or security key (cross-device) since the server does not
 * pin the attachment.
 */
export function PasskeyPrompt({ returnTo, reason }: PasskeyPromptProps) {
  const t = useTranslations("auth.passkeyPrompt");
  const router = useRouter();
  const supported = useBrowserSupportsWebAuthn();
  const platform = usePlatformAuthenticator();
  const earn = reason === "earn";
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
      {earn && supported && platform === false ? (
        <Notice tone="info">{t("noPlatformHint")}</Notice>
      ) : null}
      {earn && !supported ? (
        <>
          <Notice tone="info">{t("unsupportedEarnBody")}</Notice>
          <Button asChild variant="secondary">
            <Link href={returnTo as Route}>{t("earnBackCta")}</Link>
          </Button>
        </>
      ) : supported ? (
        <>
          <Button type="button" onClick={handleAdd} disabled={isPending}>
            {t("addCta")}
          </Button>
          <Button type="button" variant="secondary" onClick={goOn} disabled={isPending}>
            {t(earn ? "earnBackCta" : "notNowCta")}
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
