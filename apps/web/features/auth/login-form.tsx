"use client";

import { useTranslations } from "next-intl";
import Link from "next/link";
import { Input } from "@yourtal/ui/input";
import { Button } from "@yourtal/ui/button";
import { Notice } from "@yourtal/ui/notice";
import { authErrorMessage } from "@/features/auth/auth-error-copy";
import { loginAction } from "@/lib/api/actions";
import { clearSessionScopedServiceWorkerCache } from "@/features/shell/clear-session-cache";

export interface LoginFormProps {
  returnTo?: string | undefined;
  errorCode?: string | undefined;
}

/**
 * 6.9.b's other half: `clear-session-cache.ts` flagged this as unwired
 * because `/login` was still Area A's placeholder. Now that the real
 * `(auth)/login` page (6.2.a) exists, a fresh sign-in on a device that
 * still has a PREVIOUS session's pages cached needs the same "forget
 * this device's cached pages" call `logout-button.tsx` makes — otherwise
 * `app/sw.ts`'s NetworkFirst fallback can still answer, offline, for the
 * account that was signed in before this one. `onSubmit` fires before
 * `loginAction` (a Server Action) runs; it does not delay or intercept the
 * submission.
 *
 * Split out of `(auth)/login/page.tsx` only because a Server Component
 * cannot pass a plain event-handler closure to a native `<form>` — the
 * page above stays a Server Component for the `searchParams`/`returnTo`
 * read, and hands this component only the two plain strings it needs.
 */
export function LoginForm({ returnTo, errorCode }: LoginFormProps) {
  const t = useTranslations("auth.login");

  return (
    <form
      action={loginAction}
      onSubmit={() => clearSessionScopedServiceWorkerCache()}
      className="flex flex-col gap-4"
    >
      {returnTo ? (
        // eslint-disable-next-line yt-b/prefer-primitives
        <input type="hidden" name="returnTo" value={returnTo} />
      ) : null}
      {errorCode ? <Notice tone="danger">{authErrorMessage(t, errorCode)}</Notice> : null}
      <Input label={t("emailLabel")} name="email" type="email" autoComplete="email" required />
      <Input
        label={t("passwordLabel")}
        name="password"
        type="password"
        autoComplete="current-password"
        required
      />
      <Button type="submit">{t("submitCta")}</Button>
      <Link
        href="/forgot"
        className="text-body-sm font-sans text-accent underline underline-offset-4"
      >
        {t("forgotCta")}
      </Link>
    </form>
  );
}
