"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@yourtal/ui/button";
import { Notice } from "@yourtal/ui/notice";
import { authErrorMessage } from "@/features/auth/auth-error-copy";
import { runAuthentication, useBrowserSupportsWebAuthn } from "@/features/auth/passkey-ceremony";
import {
  passkeySignInAction,
  passkeySignInOptionsAction,
} from "@/features/auth/second-factor-actions";
import { clearSessionScopedServiceWorkerCache } from "@/features/shell/clear-session-cache";

export interface PasskeySignInButtonProps {
  returnTo?: string | undefined;
}

/**
 * "Sign in with a passkey" under the password form. Rendered only where the
 * browser can do WebAuthn (decided after hydration, so the server HTML and the
 * first client render agree), and a closed or failed prompt is an inline
 * message, never a crash. Success redirects from the server action.
 */
export function PasskeySignInButton({ returnTo }: PasskeySignInButtonProps) {
  const t = useTranslations("auth.login");
  const supported = useBrowserSupportsWebAuthn();
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  if (!supported) return null;

  function handleClick() {
    setErrorCode(null);
    startTransition(async () => {
      // Same reason as the password form: forget the previous account's cached pages.
      clearSessionScopedServiceWorkerCache();
      const ceremony = await runAuthentication(passkeySignInOptionsAction);
      if (!ceremony.ok) {
        setErrorCode(ceremony.code);
        return;
      }
      const result = await passkeySignInAction(
        ceremony.data.challengeId,
        ceremony.data.response,
        returnTo,
      );
      setErrorCode(result.code);
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-center text-body-sm font-sans text-fg-muted">{t("passkeyOr")}</p>
      {errorCode ? <Notice tone="danger">{authErrorMessage(t, errorCode)}</Notice> : null}
      <Button type="button" variant="secondary" onClick={handleClick} disabled={isPending}>
        {t("passkeyCta")}
      </Button>
    </div>
  );
}
