import { getTranslations } from "next-intl/server";
import type { PublicListing } from "@yourtal/contracts/listing";
import type { WalletSummary } from "@yourtal/contracts/wallet/wallet";
import { asDisplayPoints, formatPointsIn } from "@yourtal/contracts/money/format";
import { CoinMark } from "@yourtal/ui/brand/coin-mark";
import { Progress } from "@yourtal/ui/progress";
import { formatWalletDate, type SupportedLocale } from "./wallet-format";

export interface WalletHeroProps {
  balance: WalletSummary;
  nextReward: PublicListing | null;
  locale: SupportedLocale;
}

const NUMBER: Record<SupportedLocale, Intl.NumberFormat> = {
  "en-AU": new Intl.NumberFormat("en-AU"),
  "id-ID": new Intl.NumberFormat("id-ID"),
};

/**
 * 13.19.a: what the viewer can spend now, what is still on its way and when
 * it lands, and the next reward within reach with how far there is to go.
 */
export async function WalletHero({ balance, nextReward, locale }: WalletHeroProps) {
  const t = await getTranslations("wallet");
  const pts = (n: number) => formatPointsIn(locale, asDisplayPoints(n));
  const toGo = nextReward ? nextReward.priceInPoints - balance.availablePoints : 0;

  return (
    <section
      aria-labelledby="wallet-available"
      className="relative overflow-hidden rounded-sheet border border-border-subtle bg-surface p-5 sm:p-7"
    >
      {/* The gold disc is the wallet's one flourish: the coin, oversized, half off the card. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-10 -top-10 size-44 rounded-full bg-points opacity-15 blur-2xl"
      />
      <div className="relative flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
        <div className="flex flex-col gap-1">
          <p id="wallet-available" className="text-label font-sans font-semibold text-fg-muted">
            {t("overview.available")}
          </p>
          <p className="flex items-center gap-3 font-display text-display-lg font-extrabold tabular-nums text-fg">
            <CoinMark size={44} className="shrink-0" />
            {NUMBER[locale].format(balance.availablePoints)}
            <span className="self-end pb-2 text-title font-sans font-semibold text-fg-muted">
              {t("overview.pointsUnit")}
            </span>
          </p>
          {balance.pendingPoints > 0 ? (
            <ul className="mt-2 flex flex-col gap-1">
              {balance.pending.map((part) => (
                <li
                  key={part.unlockAt}
                  className="flex items-center gap-2 text-body-sm font-sans text-fg-muted"
                >
                  <span className="size-2 rounded-full bg-warning-solid" aria-hidden="true" />
                  {t("overview.pending", {
                    points: pts(part.points),
                    date: formatWalletDate(part.unlockAt, locale),
                  })}
                </li>
              ))}
            </ul>
          ) : null}
          {balance.expiringPoints > 0 && balance.expiringAt ? (
            <p className="text-body-sm font-sans text-danger-solid">
              {t("overview.expiring", {
                points: pts(balance.expiringPoints),
                date: formatWalletDate(balance.expiringAt, locale),
              })}
            </p>
          ) : null}
        </div>

        {nextReward ? (
          <a
            href={`/store/${nextReward.id}`}
            className="group flex w-full flex-col gap-3 rounded-card border border-border-subtle bg-canvas p-4 transition-colors hover:border-border-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus lg:max-w-sm"
          >
            <span className="flex items-center gap-3">
              <img
                src={nextReward.imageUrl}
                alt=""
                className="size-12 shrink-0 rounded-control bg-surface-sunken object-cover"
              />
              <span className="flex min-w-0 flex-col">
                <span className="text-caption font-sans font-semibold uppercase tracking-wide text-fg-muted">
                  {t("overview.nextReward")}
                </span>
                <span className="text-body-sm font-sans font-semibold text-fg group-hover:underline">
                  {t("overview.toGo", {
                    points: pts(toGo),
                    title: nextReward.title,
                  })}
                </span>
              </span>
            </span>
            <Progress
              value={balance.availablePoints}
              max={nextReward.priceInPoints}
              aria-label={t("overview.progressLabel", {
                have: pts(balance.availablePoints),
                need: pts(nextReward.priceInPoints),
              })}
              className="h-2"
            />
          </a>
        ) : null}
      </div>
    </section>
  );
}
