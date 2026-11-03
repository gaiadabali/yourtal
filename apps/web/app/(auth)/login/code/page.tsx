import { redirect } from "next/navigation";
import type { Route } from "next";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { AuthCard } from "@/features/auth/auth-card";
import { LoginCodeForm } from "@/features/auth/login-code-form";
import { parseReturnTo } from "@/features/onboarding/onboarding-return-to";
import { readMfaPendingToken } from "@/lib/api/session-cookies";

export interface LoginCodePageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * `/login/code`: the second step of a password sign-in for an account with an
 * authenticator app. The half-finished sign-in lives in an httpOnly cookie, so
 * nothing secret is in the URL; with no cookie (expired, or opened cold) there
 * is nothing to finish and the person starts again at `/login`.
 */
export default async function LoginCodePage({ searchParams }: LoginCodePageProps) {
  const params = await searchParams;
  const returnTo = parseReturnTo(params["returnTo"]);

  if ((await readMfaPendingToken()) === null) {
    const query = new URLSearchParams({ error: "second_step_expired" });
    if (returnTo) query.set("returnTo", returnTo);
    redirect(`/login?${query.toString()}` as Route);
  }

  const t = await getTranslations("auth.code");
  const errorEntry = params["error"];
  const errorCode = typeof errorEntry === "string" ? errorEntry : undefined;

  return (
    <AuthCard
      title={t("heading")}
      description={t("intro")}
      footer={
        <Link
          href={returnTo ? { pathname: "/login", query: { returnTo } } : "/login"}
          className="text-accent underline underline-offset-4"
        >
          {t("startOverCta")}
        </Link>
      }
    >
      <LoginCodeForm returnTo={returnTo ?? undefined} errorCode={errorCode} />
    </AuthCard>
  );
}
