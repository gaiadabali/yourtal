import { z } from "zod";
import { Card, CardContent, CardHeader, CardTitle } from "@yourtal/ui/card";
import { MoneyAmount } from "@yourtal/ui/money-amount";
import { DataTable } from "@yourtal/ui/data-table";
import type { BoostView } from "@yourtal/contracts/studio/boost";
import { apiFetch } from "@/lib/api/api-fetch";
import { getStudioTranslator, type SupportedLocale } from "../studio-i18n";
import { listBoostCharges, loadBoost } from "./boost-actions";

const campaignListSchema = z.array(
  z.object({ id: z.string(), title: z.string(), lifecycleState: z.string() }),
);

/** 13.23.c: the business's boost charges on its Billing statement, one per campaign per day. */
export async function BoostChargesCard({
  businessId,
  locale,
}: {
  businessId: string;
  locale: SupportedLocale;
}) {
  const t = getStudioTranslator(locale);
  const charges = await listBoostCharges(businessId);
  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">{t("boost.chargesTitle")}</CardTitle>
      </CardHeader>
      <CardContent>
        {charges.length === 0 ? (
          <p className="text-body-sm font-sans text-fg-muted">{t("boost.chargesEmpty")}</p>
        ) : (
          <DataTable
            caption={t("boost.chargesTitle")}
            rows={charges}
            getRowKey={(charge) => charge.id}
            columns={[
              { key: "day", header: t("boost.chargesDay"), cell: (charge) => charge.day },
              {
                key: "campaign",
                header: t("boost.chargesCampaign"),
                cell: (charge) => charge.campaignTitle,
              },
              {
                key: "impressions",
                header: t("boost.chargesImpressions"),
                align: "end",
                cell: (charge) => charge.impressions,
              },
              {
                key: "amount",
                header: t("boost.chargesAmount"),
                align: "end",
                cell: (charge) => (
                  <MoneyAmount
                    amountMinor={charge.amountMinor}
                    currency={charge.currency}
                    locale={locale}
                  />
                ),
              },
            ]}
          />
        )}
      </CardContent>
    </Card>
  );
}

/** 13.23.d: Reports' boost panel — boosted impressions, spend and average price per campaign. */
export async function BoostReportCard({
  businessId,
  locale,
}: {
  businessId: string;
  locale: SupportedLocale;
}) {
  const t = getStudioTranslator(locale);
  const campaigns = await apiFetch(`/api/${businessId}/studio/campaigns`, campaignListSchema);
  const live = campaigns.ok ? campaigns.data.filter((c) => c.lifecycleState === "live") : [];
  const views = await Promise.all(
    live.map(async (campaign) => ({ campaign, result: await loadBoost(businessId, campaign.id) })),
  );
  const boosted = views.flatMap(({ campaign, result }) =>
    result.ok && result.view.setting !== null ? [{ title: campaign.title, view: result.view }] : [],
  );
  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">{t("boost.reportTitle")}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {boosted.length === 0 ? (
          <p className="text-body-sm font-sans text-fg-muted">{t("boost.reportEmpty")}</p>
        ) : (
          boosted.map(({ title, view }) => (
            <BoostRow key={view.campaignId} title={title} view={view} locale={locale} />
          ))
        )}
      </CardContent>
    </Card>
  );
}

function BoostRow({
  title,
  view,
  locale,
}: {
  title: string;
  view: BoostView;
  locale: SupportedLocale;
}) {
  const t = getStudioTranslator(locale);
  return (
    <div className="flex flex-col gap-2 rounded-control border border-border-subtle p-3">
      <h3 className="text-body font-sans font-medium text-fg">{title}</h3>
      <dl className="grid grid-cols-3 gap-3 text-body-sm font-sans">
        <div>
          <dt className="text-fg-muted">{t("boost.impressions")}</dt>
          <dd className="text-fg">{view.impressions}</dd>
        </div>
        <div>
          <dt className="text-fg-muted">{t("boost.spend")}</dt>
          <dd className="text-fg">
            <MoneyAmount amountMinor={view.spendMinor} currency={view.currency} locale={locale} />
          </dd>
        </div>
        <div>
          <dt className="text-fg-muted">{t("boost.averagePrice")}</dt>
          <dd className="text-fg">
            {view.averageCpmMinor === null ? (
              "—"
            ) : (
              <MoneyAmount
                amountMinor={view.averageCpmMinor}
                currency={view.currency}
                locale={locale}
              />
            )}
          </dd>
        </div>
      </dl>
    </div>
  );
}
