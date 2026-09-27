import { getTranslations } from "next-intl/server";
import { Button } from "@yourtal/ui/button";
import { Notice } from "@yourtal/ui/notice";
import { AuthCard } from "@/features/auth/auth-card";
import { authErrorMessage } from "@/features/auth/auth-error-copy";
import { verifyEmailAction } from "@/features/auth/auth-actions";

export interface VerifyEmailPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * `/verify?token=…` (6.2.a). Confirming is a real button click, not a side
 * effect of loading this page — `verifyEmailAction`'s own doc comment says
 * why: the token is single-use, and a link-prefetching email client would
 * otherwise burn it before the person ever sees the page.
 */
export default async function VerifyEmailPage({ searchParams }: VerifyEmailPageProps) {
  const params = await searchParams;
  const t = await getTranslations("auth.verify");
  const tokenEntry = params["token"];
  const token = typeof tokenEntry === "string" ? tokenEntry : "";
  const errorEntry = params["error"];
  const errorCode = typeof errorEntry === "string" ? errorEntry : undefined;
  const verified = params["verified"] === "1";

  return (
    <AuthCard title={t("heading")} description={t("intro")}>
      {verified ? (
        <Notice tone="success" title={t("verifiedTitle")}>
          {t("verifiedBody")}
        </Notice>
      ) : token === "" ? (
        <Notice tone="warning">{t("missingTokenNotice")}</Notice>
      ) : (
        <form action={verifyEmailAction} className="flex flex-col gap-4">
          {/* eslint-disable-next-line yt-b/prefer-primitives */}
          <input type="hidden" name="token" value={token} />
          {errorCode ? <Notice tone="danger">{authErrorMessage(t, errorCode)}</Notice> : null}
          <Button type="submit">{t("submitCta")}</Button>
        </form>
      )}
    </AuthCard>
  );
}
