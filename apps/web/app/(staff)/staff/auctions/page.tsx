import { getLocale, getTranslations } from "next-intl/server";
import { auctionListSchema } from "@yourtal/contracts/auction/auction";
import { Badge } from "@yourtal/ui/badge";
import { Card, CardContent } from "@yourtal/ui/card";
import { EmptyState } from "@yourtal/ui/empty-state";
import { MoneyAmount } from "@yourtal/ui/money-amount";
import { PageHeader } from "@yourtal/ui/page-header";
import { apiFetch } from "@/lib/api/api-fetch";
import { requireStaffSession } from "@/features/staff/staff-session";
import { StaffAuctionCancel } from "@/features/staff/auctions/staff-auction-cancel";

/** `/staff/auctions` (13.22.g): every open charity auction; ops cancel one with a reason. */
export default async function StaffAuctionsPage() {
  await requireStaffSession();
  const [t, locale, result] = await Promise.all([
    getTranslations("staff"),
    getLocale(),
    apiFetch("/api/staff/auctions", auctionListSchema),
  ]);
  if (!result.ok) throw new Error(`Could not load auctions: ${result.error.message}`);
  const auctions = result.data.auctions;
  const display = locale === "id-ID" ? "id-ID" : "en-AU";
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t("auctions.pageTitle")} description={t("auctions.pageDescription")} />
      {auctions.length === 0 ? (
        <EmptyState title={t("auctions.empty")} headingLevel={2} />
      ) : (
        <ul className="flex flex-col gap-3">
          {auctions.map((auction) => (
            <li key={auction.auctionId}>
              <Card>
                <CardContent className="flex flex-col gap-2 p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="font-sans text-body font-semibold text-fg">
                      {auction.voucher.title}
                    </h2>
                    <Badge variant="secondary">{auction.region}</Badge>
                  </div>
                  <p className="font-sans text-body-sm text-fg-muted">
                    {t("auctions.for", { charity: auction.charity.name })} ·{" "}
                    {t("auctions.bids", { count: auction.bidCount })} ·{" "}
                    {t("auctions.ends", { date: auction.endsAt.slice(0, 16).replace("T", " ") })}
                  </p>
                  <p className="font-sans text-body-sm text-fg">
                    {t("auctions.current")}{" "}
                    <MoneyAmount
                      amountMinor={auction.currentAmountMinor ?? auction.reserveMinor}
                      currency={auction.currency}
                      locale={display}
                    />
                  </p>
                  <StaffAuctionCancel auctionId={auction.auctionId} title={auction.voucher.title} />
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
