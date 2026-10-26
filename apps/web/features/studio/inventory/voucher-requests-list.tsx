import type { VoucherBatchRequest } from "@yourtal/contracts/listing/voucher-batch-request";
import { Badge } from "@yourtal/ui/badge";
import type { Region } from "@yourtal/contracts/region";
import { REGION_TIME_ZONE } from "@/features/region/region-time-zone";
import { getStudioTranslator, type SupportedLocale } from "../studio-i18n";

const STATE_VARIANT = {
  pending: "warning",
  approved: "success",
  rejected: "secondary",
} as const;

export interface VoucherRequestsListProps {
  /** This listing's requests, newest first; `null` when the list could not be loaded. */
  requests: readonly VoucherBatchRequest[] | null;
  locale: SupportedLocale;
  /** The listing's region: its zone decides the day each request is dated. */
  region: Region;
}

/** The requests for one listing and where each stands. Every state has words: loading is the page's, the rest are here. */
export function VoucherRequestsList({ requests, locale, region }: VoucherRequestsListProps) {
  const t = getStudioTranslator(locale);
  const date = new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeZone: REGION_TIME_ZONE[region],
  });
  return (
    // No accessible name: one per listing, so a named section would repeat the same landmark.
    <section className="flex flex-col gap-1.5">
      <h3 className="text-body-sm font-sans font-medium text-fg">
        {t("inventory.requests.title")}
      </h3>
      {requests === null ? (
        <p role="alert" className="text-body-sm font-sans text-danger-solid">
          {t("inventory.requests.unavailable")}
        </p>
      ) : requests.length === 0 ? (
        <p className="text-body-sm font-sans text-fg-muted">{t("inventory.requests.empty")}</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {requests.map((request) => (
            <li key={request.id} className="flex flex-wrap items-center gap-2 text-body-sm">
              <Badge variant={STATE_VARIANT[request.state]}>
                {t(`inventory.requests.state.${request.state}`)}
              </Badge>
              <span className="font-sans text-fg">
                {t("inventory.requests.line", {
                  quantity: request.quantity,
                  date: date.format(new Date(request.createdAt)),
                })}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
