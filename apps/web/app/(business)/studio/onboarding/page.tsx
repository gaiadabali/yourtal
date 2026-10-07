import { redirect } from "next/navigation";
import { PageHeader } from "@yourtal/ui/page-header";
import { PageContainer } from "@yourtal/ui/page-container";
import { getLocale } from "next-intl/server";
import { getRegion } from "@/features/region/get-region";
import { resolveStudioContext } from "@/features/studio/studio-context";
import Link from "next/link";
import { getStudioTranslator, resolveSupportedLocale } from "@/features/studio/studio-i18n";
import { BusinessOnboardingForm } from "@/features/studio/onboarding/business-onboarding-form";

/**
 * `/studio/onboarding` (task 7.8.b) — register a business. Reachable
 * directly, and where `/studio` sends a signed-in person with zero
 * memberships. `region` is fixed to the signed-in person's own account
 * region (TASKS.md 7.1.a) — this screen never offers a region choice.
 */
export default async function StudioOnboardingPage(props: PageProps<"/studio/onboarding">) {
  const searchParams = await props.searchParams;
  const { current } = await resolveStudioContext({});
  if (current) {
    redirect("/studio");
  }

  const region = await getRegion();
  const locale = resolveSupportedLocale(await getLocale());
  const t = getStudioTranslator(locale);
  const errorParam = searchParams.error;
  const errorField = typeof errorParam === "string" ? errorParam : null;

  return (
    <PageContainer width="narrow" className="flex flex-col gap-6 py-8">
      <PageHeader title={t("onboarding.title")} description={t("onboarding.description")} />
      <Link
        href="/studio/join"
        className="w-fit text-body-sm font-sans text-accent underline underline-offset-4"
      >
        {t("onboarding.joinInstead")}
      </Link>
      <BusinessOnboardingForm region={region} errorField={errorField} locale={locale} />
    </PageContainer>
  );
}
