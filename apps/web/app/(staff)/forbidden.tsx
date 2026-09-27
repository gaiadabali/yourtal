import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { PageContainer } from "@yourtal/ui/page-container";
import { PageHeader } from "@yourtal/ui/page-header";

/** What `forbidden()` renders, with HTTP 403, for a signed-in account that is not working staff. */
export default async function StaffForbidden() {
  const t = await getTranslations("staff.forbidden");
  return (
    <main className="min-h-dvh bg-canvas py-12">
      <PageContainer className="flex flex-col gap-6">
        <PageHeader title={t("title")} description={t("body")} />
        <Link href="/home" className="text-label font-sans text-accent underline">
          {t("home")}
        </Link>
      </PageContainer>
    </main>
  );
}
