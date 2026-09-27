import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { Input } from "@yourtal/ui/input";
import { Button } from "@yourtal/ui/button";
import { Notice } from "@yourtal/ui/notice";
import { AuthCard } from "@/features/auth/auth-card";
import { authErrorMessage } from "@/features/auth/auth-error-copy";
import { forgotPasswordAction } from "@/features/auth/auth-actions";

export interface ForgotPasswordPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * `/forgot` (6.2.a). `requestPasswordReset` (1.4.f) always reports success
 * — see `auth.errors.ts` — so this page never says whether the email was
 * registered, only that a link is on its way if it was.
 */
export default async function ForgotPasswordPage({ searchParams }: ForgotPasswordPageProps) {
  const params = await searchParams;
  const t = await getTranslations("auth.forgot");
  const errorEntry = params["error"];
  const errorCode = typeof errorEntry === "string" ? errorEntry : undefined;
  const sent = params["sent"] === "1";

  return (
    <AuthCard
      title={t("heading")}
      description={t("intro")}
      footer={
        <Link href="/login" className="text-accent underline underline-offset-4">
          {t("backToSignIn")}
        </Link>
      }
    >
      {sent ? (
        <Notice tone="success" title={t("sentTitle")}>
          {t("sentBody")}
        </Notice>
      ) : (
        <form action={forgotPasswordAction} className="flex flex-col gap-4">
          {errorCode ? <Notice tone="danger">{authErrorMessage(t, errorCode)}</Notice> : null}
          <Input label={t("emailLabel")} name="email" type="email" autoComplete="email" required />
          <Button type="submit">{t("submitCta")}</Button>
        </form>
      )}
    </AuthCard>
  );
}
