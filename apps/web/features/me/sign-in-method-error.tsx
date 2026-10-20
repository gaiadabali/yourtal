"use client";

import { useTranslations } from "next-intl";
import { Button } from "@yourtal/ui/button";
import { Notice } from "@yourtal/ui/notice";
import { clearSessionScopedServiceWorkerCache } from "@/features/shell/clear-session-cache";
import { signInAgainAction } from "./sign-in-methods-actions";

export interface SignInMethodErrorProps {
  code: string;
}

/**
 * The inline error for any passkey or authenticator-app change. A change that
 * needs a recent sign-in (`reauthentication_required`) says so and offers to
 * sign out and come straight back to Me; everything else is plain copy, with
 * a generic fallback for a code the catalogue does not name.
 */
export function SignInMethodError({ code }: SignInMethodErrorProps) {
  const t = useTranslations("me.signInMethods");

  if (code === "reauthentication_required") {
    return (
      <Notice
        tone="warning"
        action={
          <form action={signInAgainAction} onSubmit={() => clearSessionScopedServiceWorkerCache()}>
            <Button type="submit" variant="secondary" size="sm">
              {t("signInAgainCta")}
            </Button>
          </form>
        }
      >
        {t("reauthRequired")}
      </Notice>
    );
  }

  const key = `errors.${code}`;
  return <Notice tone="danger">{t.has(key) ? t(key) : t("errors.unknown")}</Notice>;
}
