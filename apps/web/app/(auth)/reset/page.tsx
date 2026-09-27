import { getTranslations } from "next-intl/server";
import { Input } from "@yourtal/ui/input";
import { Button } from "@yourtal/ui/button";
import { Notice } from "@yourtal/ui/notice";
import { AuthCard } from "@/features/auth/auth-card";
import { authErrorMessage } from "@/features/auth/auth-error-copy";
import { resetPasswordAction } from "@/features/auth/auth-actions";

export interface ResetPasswordPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * `/reset?token=…` (6.2.a) — the link `confirmPasswordReset`'s emailed
 * token points at. A missing token never reaches the API: this page shows
 * a plain notice instead of submitting an empty one that would only ever
 * come back `token_invalid`.
 */
export default async function ResetPasswordPage({ searchParams }: ResetPasswordPageProps) {
  const params = await searchParams;
  const t = await getTranslations("auth.reset");
  const tokenEntry = params["token"];
  const token = typeof tokenEntry === "string" ? tokenEntry : "";
  const errorEntry = params["error"];
  const errorCode = typeof errorEntry === "string" ? errorEntry : undefined;

  return (
    <AuthCard title={t("heading")} description={t("intro")}>
      {token === "" ? (
        <Notice tone="warning">{t("missingTokenNotice")}</Notice>
      ) : (
        <form action={resetPasswordAction} className="flex flex-col gap-4">
          {/* eslint-disable-next-line yt-b/prefer-primitives */}
          <input type="hidden" name="token" value={token} />
          {errorCode ? <Notice tone="danger">{authErrorMessage(t, errorCode)}</Notice> : null}
          <Input
            label={t("newPasswordLabel")}
            name="newPassword"
            type="password"
            autoComplete="new-password"
            minLength={12}
            required
          />
          <Button type="submit">{t("submitCta")}</Button>
        </form>
      )}
    </AuthCard>
  );
}
