import { getLocale, getTranslations } from "next-intl/server";
import { Card, CardContent, CardHeader, CardTitle } from "@yourtal/ui/card";
import { DataTable } from "@yourtal/ui/data-table";
import { EmptyState } from "@yourtal/ui/empty-state";
import { MoneyAmount } from "@yourtal/ui/money-amount";
import { PageHeader } from "@yourtal/ui/page-header";
import { loadCharityConsole } from "@/features/charity/charity-data";

/**
 * `/charity/[charityId]` (13.21.c): a charity member's console. It lists
 * auction proceeds and monthly statements, money already paid to the
 * charity's own account; YourTal holds no balance for it (red line 8).
 */
export default async function CharityConsolePage(props: {
  params: Promise<{ charityId: string }>;
}) {
  const { charityId } = await props.params;
  const [t, locale, data] = await Promise.all([
    getTranslations("charity"),
    getLocale(),
    loadCharityConsole(charityId),
  ]);
  const displayLocale = locale === "id-ID" ? "id-ID" : "en-AU";
  if (data === null) {
    return (
      <>
        <PageHeader title={t("console.title")} />
        <EmptyState title={t("console.notFound")} headingLevel={2} />
      </>
    );
  }
  const { charity } = data;
  return (
    <>
      <PageHeader title={charity.name} description={t("console.note")} />
      <p className="font-sans text-body-sm text-fg-muted">
        {t("console.account", { last4: charity.payoutAccountLast4 })}
      </p>
      <Card>
        <CardHeader>
          <CardTitle as="h2">{t("console.proceedsTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          {data.proceeds.length === 0 ? (
            <p className="font-sans text-body-sm text-fg-muted">{t("console.proceedsEmpty")}</p>
          ) : (
            <DataTable
              caption={t("console.proceedsTitle")}
              rows={data.proceeds}
              getRowKey={(row) => row.auctionId}
              columns={[
                {
                  key: "paidAt",
                  header: t("console.paidAt"),
                  cell: (row) => row.paidAt.slice(0, 10),
                },
                {
                  key: "auction",
                  header: t("console.auction"),
                  cell: (row) => row.auctionId.slice(0, 8),
                },
                {
                  key: "amount",
                  header: t("console.amount"),
                  align: "end",
                  cell: (row) => (
                    <MoneyAmount
                      amountMinor={row.amountMinor}
                      currency={row.currency}
                      locale={displayLocale}
                    />
                  ),
                },
              ]}
            />
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle as="h2">{t("console.statementsTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          {data.statements.length === 0 ? (
            <p className="font-sans text-body-sm text-fg-muted">{t("console.statementsEmpty")}</p>
          ) : (
            <DataTable
              caption={t("console.statementsTitle")}
              rows={data.statements}
              getRowKey={(row) => `${row.month}-${row.currency}`}
              columns={[
                { key: "month", header: t("console.month"), cell: (row) => row.month },
                {
                  key: "auctions",
                  header: t("console.auctions"),
                  align: "end",
                  cell: (row) => row.auctions,
                },
                {
                  key: "total",
                  header: t("console.total"),
                  align: "end",
                  cell: (row) => (
                    <MoneyAmount
                      amountMinor={row.totalMinor}
                      currency={row.currency}
                      locale={displayLocale}
                    />
                  ),
                },
              ]}
            />
          )}
        </CardContent>
      </Card>
    </>
  );
}
