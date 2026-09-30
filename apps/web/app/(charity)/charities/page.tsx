import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Card, CardContent } from "@yourtal/ui/card";
import { EmptyState } from "@yourtal/ui/empty-state";
import { PageHeader } from "@yourtal/ui/page-header";
import { Badge } from "@yourtal/ui/badge";
import { listCharities } from "@/features/charity/charity-data";

/** `/charities` (13.21.b): approved charities in the viewer's own region. */
export default async function CharitiesPage() {
  const [t, charities] = await Promise.all([getTranslations("charity"), listCharities()]);
  return (
    <>
      <PageHeader title={t("list.title")} description={t("list.description")} />
      {charities.length === 0 ? (
        <EmptyState title={t("list.empty")} headingLevel={2} />
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2">
          {charities.map((charity) => (
            <li key={charity.id}>
              <Card>
                <CardContent className="flex gap-4 p-4">
                  {charity.logoUrl === null ? (
                    <div
                      aria-hidden="true"
                      className="flex size-12 shrink-0 items-center justify-center rounded-pill bg-surface-sunken font-sans text-title text-fg-muted"
                    >
                      {charity.name.slice(0, 1)}
                    </div>
                  ) : (
                    <img
                      src={charity.logoUrl}
                      alt=""
                      className="size-12 shrink-0 rounded-pill object-cover"
                    />
                  )}
                  <div className="flex flex-col gap-1">
                    <h2 className="font-sans text-body font-semibold text-fg">{charity.name}</h2>
                    <Badge variant="secondary" className="self-start">
                      {t(`cause.${charity.cause}`)}
                    </Badge>
                    <p className="text-body-sm font-sans text-fg-muted">{charity.summary}</p>
                  </div>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
      <Link
        href="/charity/apply"
        className="self-start font-sans text-body-sm text-accent underline"
      >
        {t("list.applyLink")}
      </Link>
    </>
  );
}
