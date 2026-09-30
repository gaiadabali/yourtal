import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Badge } from "@yourtal/ui/badge";
import { Card, CardContent } from "@yourtal/ui/card";
import { EmptyState } from "@yourtal/ui/empty-state";
import { PageHeader } from "@yourtal/ui/page-header";
import { requireStaffSession } from "@/features/staff/staff-session";
import { listCharitiesForStaff } from "@/features/charity/charity-data";
import { StaffCharityDecision } from "@/features/staff/charities/staff-charity-decision";

const STATES = ["pending", "approved", "rejected"] as const;

/** `/staff/charities` (13.21.a): review applications; approve or reject each with a reason. */
export default async function StaffCharitiesPage(props: {
  searchParams: Promise<{ state?: string }>;
}) {
  await requireStaffSession();
  const { state } = await props.searchParams;
  const selected = STATES.find((value) => value === state);
  const [t, tc, charities] = await Promise.all([
    getTranslations("staff"),
    getTranslations("charity"),
    listCharitiesForStaff(selected ?? "pending"),
  ]);
  const current = selected ?? "pending";
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t("charities.pageTitle")} description={t("charities.pageDescription")} />
      <nav aria-label={t("charities.pageTitle")} className="flex flex-wrap gap-2">
        {STATES.map((value) => (
          <Link
            key={value}
            href={`/staff/charities?state=${value}`}
            aria-current={value === current ? "page" : undefined}
            className={
              value === current
                ? "rounded-pill bg-accent px-3 py-1 font-sans text-label text-fg-on-accent"
                : "rounded-pill bg-surface-sunken px-3 py-1 font-sans text-label text-fg"
            }
          >
            {tc(`apply.state.${value}`)}
          </Link>
        ))}
      </nav>
      {charities.length === 0 ? (
        <EmptyState title={t("charities.empty")} headingLevel={2} />
      ) : (
        <ul className="flex flex-col gap-3">
          {charities.map((charity) => (
            <li key={charity.id}>
              <Card>
                <CardContent className="flex flex-col gap-2 p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="font-sans text-body font-semibold text-fg">{charity.name}</h2>
                    <Badge variant="secondary">{charity.region}</Badge>
                    <Badge variant="secondary">{tc(`cause.${charity.cause}`)}</Badge>
                  </div>
                  <p className="font-sans text-body-sm text-fg-muted">{charity.summary}</p>
                  <p className="font-sans text-body-sm text-fg">
                    {t("charities.registration")}:{" "}
                    {charity.registration.kind === "au_acnc"
                      ? `ABN ${charity.registration.abn} · ACNC`
                      : `${charity.registration.deedNumber} · ${charity.registration.fundraisingPermitNumber}`}
                  </p>
                  <p className="font-sans text-body-sm text-fg-muted">
                    {t("charities.account", { last4: charity.payoutAccountLast4 })} ·{" "}
                    {t("charities.kyb", { reference: charity.kybReference })}
                  </p>
                  {charity.rejectionReason === null ? null : (
                    <p className="font-sans text-body-sm text-fg-muted">
                      {t("charities.rejected", { reason: charity.rejectionReason })}
                    </p>
                  )}
                  {charity.state === "pending" ? (
                    <StaffCharityDecision
                      charityId={charity.id}
                      name={charity.name}
                      region={charity.region}
                    />
                  ) : null}
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
