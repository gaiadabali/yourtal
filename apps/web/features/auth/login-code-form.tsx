"use client";

import { useTranslations } from "next-intl";
import { Input } from "@yourtal/ui/input";
import { Button } from "@yourtal/ui/button";
import { Notice } from "@yourtal/ui/notice";
import { authErrorMessage } from "@/features/auth/auth-error-copy";
import { totpSignInAction } from "@/features/auth/second-factor-actions";

export interface LoginCodeFormProps {
  returnTo?: string | undefined;
  errorCode?: string | undefined;
}

/** The six-digit code from the person's authenticator app; the server action reads the pending sign-in from its cookie. */
export function LoginCodeForm({ returnTo, errorCode }: LoginCodeFormProps) {
  const t = useTranslations("auth.code");

  return (
    <form action={totpSignInAction} className="flex flex-col gap-4">
      {returnTo ? (
        // eslint-disable-next-line yt-b/prefer-primitives
        <input type="hidden" name="returnTo" value={returnTo} />
      ) : null}
      {errorCode ? <Notice tone="danger">{authErrorMessage(t, errorCode)}</Notice> : null}
      <Input
        label={t("codeLabel")}
        name="code"
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9 ]*"
        maxLength={7}
        autoFocus
        required
      />
      <Button type="submit">{t("submitCta")}</Button>
    </form>
  );
}
