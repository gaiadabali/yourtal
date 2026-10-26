import type { Invoice } from "@yourtal/contracts/invoice";
import type { Region } from "@yourtal/contracts/region";
import { Button } from "@yourtal/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@yourtal/ui/card";
import { DataTable } from "@yourtal/ui/data-table";
import { EmptyState } from "@yourtal/ui/empty-state";
import { MoneyAmount } from "@yourtal/ui/money-amount";
import { getStudioTranslator, type SupportedLocale } from "../studio-i18n";

export interface InvoicesScreenProps {
  businessId: string;
  invoices: readonly Invoice[];
  locale: SupportedLocale;
  /** Indonesia is a demo on simulated payments and issues no invoices; its empty page says so rather than promising one. */
  region?: Region;
}

const TIME_ZONE = { AU: "Australia/Sydney", ID: "Asia/Jakarta" } as const;

/** The download goes through the web app, which holds the session (see `invoice-pdf-proxy.ts`). */
export function invoicePdfHref(businessId: string, invoiceId: string): string {
  return `/studio/billing/invoices/${invoiceId}/pdf?business=${businessId}`;
}

/**
 * 5.3 / 14.9: the business's invoices, newest first, each a PDF to download.
 * The document says "Tax invoice" only when the issuer held a valid ABN when
 * it was issued; otherwise it is an "Invoice" and the PDF says it is not a tax
 * invoice. Read-only: an issued invoice never changes.
 */
export function InvoicesScreen({ businessId, invoices, locale, region }: InvoicesScreenProps) {
  const t = getStudioTranslator(locale);
  const demo = region === "ID";

  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">{t("invoices.title")}</CardTitle>
        <p className="text-body-sm font-sans text-fg-muted">
          {t(demo ? "invoices.introDemo" : "invoices.intro")}
        </p>
      </CardHeader>
      <CardContent>
        {invoices.length === 0 ? (
          <EmptyState
            title={t(demo ? "invoices.emptyTitleDemo" : "invoices.emptyTitle")}
            description={t(demo ? "invoices.emptyDescriptionDemo" : "invoices.emptyDescription")}
          />
        ) : (
          <DataTable
            caption={t("invoices.caption")}
            rows={[...invoices]}
            getRowKey={(row) => row.id}
            columns={[
              { key: "number", header: t("invoices.numberHeader"), cell: (row) => row.number },
              {
                key: "date",
                header: t("invoices.dateHeader"),
                cell: (row) =>
                  new Intl.DateTimeFormat(locale, {
                    dateStyle: "medium",
                    timeZone: TIME_ZONE[row.region],
                  }).format(new Date(row.issuedAt)),
              },
              {
                key: "description",
                header: t("invoices.descriptionHeader"),
                cell: (row) => row.lines[0]?.description ?? "",
              },
              {
                key: "document",
                header: t("invoices.documentHeader"),
                cell: (row) =>
                  row.isTaxInvoice ? t("invoices.taxInvoice") : t("invoices.invoice"),
              },
              {
                key: "total",
                header: t("invoices.totalHeader"),
                align: "end",
                cell: (row) => (
                  <MoneyAmount
                    amountMinor={row.totalMinor}
                    currency={row.currency}
                    locale={locale}
                  />
                ),
              },
              {
                key: "download",
                header: t("invoices.downloadHeader"),
                align: "end",
                cell: (row) => (
                  <Button asChild variant="secondary" size="sm">
                    <a
                      href={invoicePdfHref(businessId, row.id)}
                      download={`${row.number}.pdf`}
                      aria-label={t("invoices.downloadLabel", { number: row.number })}
                    >
                      {t("invoices.download")}
                    </a>
                  </Button>
                ),
              },
            ]}
          />
        )}
      </CardContent>
    </Card>
  );
}
