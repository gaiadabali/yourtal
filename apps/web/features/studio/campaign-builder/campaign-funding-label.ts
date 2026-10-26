import type { BillingAllocation } from "@yourtal/contracts/billing";

/** A fixed zone per region: the server and the browser would otherwise format the time differently and React would refuse to hydrate it. */
const TIME_ZONE = { AU: "Australia/Sydney", ID: "Asia/Jakarta" } as const;

export interface FundingOption {
  allocationId: string;
  label: string;
}

type OptionT = (
  key: "campaignBuilder.reward.allocationOption",
  values: { total: string; date: string; remaining: string },
) => string;

/**
 * What the "Funded by" list shows for each pot of funded points: how many points were
 * bought, when, and how many are left, never the allocation's own id. Each purchase is
 * its own pot, so two purchases of the same package are two options; the time of purchase
 * tells them apart. Newest first.
 */
export function fundingOptions(
  allocations: readonly BillingAllocation[],
  locale: string,
  region: keyof typeof TIME_ZONE,
  t: OptionT,
): FundingOption[] {
  const numbers = new Intl.NumberFormat(locale);
  const when = new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: TIME_ZONE[region],
  });
  return [...allocations]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((allocation) => ({
      allocationId: allocation.allocationId,
      label: t("campaignBuilder.reward.allocationOption", {
        total: numbers.format(allocation.totalPoints),
        date: when.format(new Date(allocation.createdAt)),
        remaining: numbers.format(allocation.remainingPoints),
      }),
    }));
}
