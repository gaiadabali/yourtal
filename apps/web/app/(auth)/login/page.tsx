import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { AuthCard } from "@/features/auth/auth-card";
import { LoginForm } from "@/features/auth/login-form";
import { parseReturnTo } from "@/features/onboarding/onboarding-return-to";

export interface LoginPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * `/login` (6.2.a). Binds straight to Area A's `loginAction`
 * (`lib/api/actions.ts`) — not edited here, only imported — which already
 * sets `yt_session`/`yt_region`/`yt_locale` from the account's own profile
 * and redirects to `returnTo`.
 *
 * The form itself lives in `login-form.tsx` (6.9.b): a Server Component
 * cannot hand a native `<form>` a plain `onSubmit` closure, and that
 * closure — clearing this device's cached pages from a PREVIOUS session
 * before a new one starts — is what that file exists for.
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
      <LoginForm returnTo={returnTo ?? undefined} errorCode={errorCode} />
    </AuthCard>
  );
}
