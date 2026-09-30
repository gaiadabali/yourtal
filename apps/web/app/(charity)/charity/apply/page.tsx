import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Badge } from "@yourtal/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@yourtal/ui/card";
import { PageHeader } from "@yourtal/ui/page-header";
import { CharityApplyForm } from "@/features/charity/charity-apply-form";
import { listMyCharities } from "@/features/charity/charity-data";
import { getRegion } from "@/features/region/get-region";

/** `/charity/apply` (13.21.a): register a charity, and see your own applications. */
export default async function CharityApplyPage() {
  const [t, mine, region] = await Promise.all([
    getTranslations("charity"),
    listMyCharities(),
    getRegion(),
  ]);
  return (
    <>
      <PageHeader title={t("apply.title")} description={t("apply.description")} />
      {mine === null ? (
        <Link
          href="/login?next=/charity/apply"
          className="self-start font-sans text-body text-accent underline"
        >
          {t("apply.signIn")}
        </Link>
      ) : (
        <>
          {mine.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle as="h2">{t("apply.mineTitle")}</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="flex flex-col gap-2">
                  {mine.map((charity) => (
                    <li
                      key={charity.id}
                      className="flex flex-wrap items-center gap-3 font-sans text-body-sm"
                    >
                      <span className="text-fg">{charity.name}</span>
                      <Badge
                        variant={
                          charity.state === "approved"
                            ? "success"
                            : charity.state === "rejected"
                              ? "danger"
                              : "secondary"
                        }
                      >
                        {t(`apply.state.${charity.state}`)}
                      </Badge>
                      {charity.state === "approved" ? (
                        <Link href={`/charity/${charity.id}`} className="text-accent underline">
                          {t("apply.openConsole")}
                        </Link>
                      ) : null}
                      {charity.rejectionReason === null ? null : (
                        <span className="text-fg-muted">{charity.rejectionReason}</span>
                      )}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ) : null}
          <Card>
            <CardContent className="p-4">
              <CharityApplyForm region={region} />
            </CardContent>
          </Card>
        </>
      )}
    </>
  );
}
