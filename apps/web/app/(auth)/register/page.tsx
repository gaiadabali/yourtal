import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { AuthCard } from "@/features/auth/auth-card";
import { RegisterForm } from "@/features/auth/register-form";
import { parseReturnTo } from "@/features/onboarding/onboarding-return-to";
import { getRegion } from "@/features/region/get-region";
import { getDisplayLocale } from "@/i18n/get-locale";
import { isStaging } from "@/features/shell/app-env";

export interface RegisterPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * `/register` (6.2.a). The guardian-email field only ever appears for a
 * 13-17 date of birth while teen registration is open (F4). The
 * `TEEN_ACCOUNTS` flag itself is never sent to the browser — it reaches
 * minors, and `env.schema.ts`'s own comment is explicit that this stays
 * server-only — so this page uses `isStaging()` as the client-visible
 * proxy F4 ties it to ("on in staging only, pending counsel review").
 * Cosmetic either way: `AuthService.register` (1.4.b) is the real gate
 * regardless of what this page shows or hides.
 */
export default async function RegisterPage({ searchParams }: RegisterPageProps) {
  const params = await searchParams;
  const t = await getTranslations("auth.register");
  const returnTo = parseReturnTo(params["returnTo"]);
  const errorEntry = params["error"];
  const errorCode = typeof errorEntry === "string" ? errorEntry : undefined;
  const [defaultRegion, defaultLocale] = await Promise.all([getRegion(), getDisplayLocale()]);

  return (
    <AuthCard
      title={t("heading")}
      description={t("intro")}
      footer={
        <>
          {t("signInPrompt")}{" "}
          <Link href="/login" className="text-accent underline underline-offset-4">
            {t("signInCta")}
          </Link>
        </>
      }
    >
      <RegisterForm
        returnTo={returnTo}
        defaultRegion={defaultRegion}
        defaultLocale={defaultLocale}
        teenModeEnabled={isStaging()}
        {...(errorCode ? { errorCode } : {})}
      />
    </AuthCard>
  );
}
