import Link from "next/link";
import { getLocale } from "next-intl/server";
import { PageContainer } from "@yourtal/ui/page-container";
import { PageHeader } from "@yourtal/ui/page-header";
import { getStudioTranslator, resolveSupportedLocale } from "@/features/studio/studio-i18n";
import { JoinBusinessForm } from "@/features/studio/onboarding/join-business-form";

/** `/studio/join` (13.3.b): accept a team invitation; the email carries the code. */
export default async function StudioJoinPage(props: PageProps<"/studio/join">) {
  const searchParams = await props.searchParams;
  const locale = resolveSupportedLocale(await getLocale());
  const t = getStudioTranslator(locale);
  const token = typeof searchParams.token === "string" ? searchParams.token : "";

  return (
    <PageContainer width="narrow" className="flex flex-col gap-6 py-8">
      <PageHeader title={t("join.title")} description={t("join.description")} />
      <JoinBusinessForm token={token} failed={searchParams.error === "invalid"} locale={locale} />
      <Link href="/studio/onboarding" className="w-fit text-body-sm font-sans text-accent underline underline-offset-4">
        {t("join.registerInstead")}
      </Link>
    </PageContainer>
  );
}
