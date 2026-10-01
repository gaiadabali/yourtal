import { getTranslations } from "next-intl/server";
import { Badge } from "@yourtal/ui/badge";
import { Card, CardContent } from "@yourtal/ui/card";
import { KeyValue } from "@yourtal/ui/key-value";
import { PageHeader } from "@yourtal/ui/page-header";
import { requireStaffSession } from "@/features/staff/staff-session";
import { DemoResetCard } from "@/features/staff/demo/demo-reset-card";

/** `/staff`: who is signed in, with which staff roles. Sections arrive with 9.2–9.5. */
export default async function StaffOverviewPage({
  searchParams,
}: {
  searchParams: Promise<{ demo?: string }>;
}) {
  const session = await requireStaffSession();
  const { demo } = await searchParams;
  const demoWorld = session.roles.includes("admin") && process.env["APP_ENV"] !== "production";
  const t = await getTranslations("staff");
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t("overview.title")} description={t("overview.intro")} />
      <Card>
        <CardContent className="pt-4">
          <KeyValue
            items={[
              { key: "email", label: t("overview.email"), value: session.email ?? "—" },
              {
                key: "roles",
                label: t("overview.roles"),
                value: (
                  <span className="flex flex-wrap gap-1">
                    {session.roles.map((role) => (
                      <Badge key={role} variant="secondary">
                        {t(`roles.${role}`)}
                      </Badge>
                    ))}
                  </span>
                ),
              },
              { key: "region", label: t("overview.region"), value: t(`regions.${session.region}`) },
            ]}
          />
        </CardContent>
      </Card>
      {demoWorld ? <DemoResetCard outcome={demo} /> : null}
    </div>
  );
}
