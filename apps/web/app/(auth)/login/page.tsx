import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { Input } from "@yourtal/ui/input";
import { Button } from "@yourtal/ui/button";
import { Notice } from "@yourtal/ui/notice";
import { AuthCard } from "@/features/auth/auth-card";
import { authErrorMessage } from "@/features/auth/auth-error-copy";
import { parseReturnTo } from "@/features/onboarding/onboarding-return-to";
import { loginAction } from "@/lib/api/actions";

export interface LoginPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * `/login` (6.2.a). Binds straight to Area A's `loginAction`
 * (`lib/api/actions.ts`) — not edited here, only imported — which already
 * sets `yt_session`/`yt_region`/`yt_locale` from the account's own profile
 * and redirects to `returnTo`.
 */
export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams;
  const t = await getTranslations("auth.login");
  const returnTo = parseReturnTo(params["returnTo"]);
  const errorEntry = params["error"];
  const errorCode = typeof errorEntry === "string" ? errorEntry : undefined;

  return (
    <AuthCard
      title={t("heading")}
      description={t("intro")}
      footer={
        <>
          {t("signUpPrompt")}{" "}
          <Link href="/register" className="text-accent underline underline-offset-4">
            {t("signUpCta")}
          </Link>
        </>
      }
    >
      <form action={loginAction} className="flex flex-col gap-4">
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
    </AuthCard>
  );
}
