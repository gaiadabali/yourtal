import { getTranslations } from "next-intl/server";
import { Gift } from "lucide-react";
import type { WalletGift } from "@yourtal/contracts/wallet/wallet-gift";
import { MoneyAmount } from "@yourtal/ui/money-amount";
import { StatusBadge } from "@yourtal/ui/status-badge";
import { GiftResponseButtons } from "./gift-response-buttons";
import { formatWalletDate, type SupportedLocale } from "./wallet-format";

export interface WalletGiftsProps {
  gifts: readonly WalletGift[];
  locale: SupportedLocale;
}

export function isAwaitingMe(gift: WalletGift): boolean {
  return gift.direction === "received" && gift.status === "pending";
}

/**
 * 13.20.c: gifts waiting for the viewer's answer, at the top of the wallet.
 * The sender is named by display name only; there is no message.
 */
export async function WalletGiftInbox({ gifts, locale }: WalletGiftsProps) {
  const t = await getTranslations("wallet");
  const waiting = gifts.filter(isAwaitingMe);
  if (waiting.length === 0) return null;
  return (
    <section aria-labelledby="gift-inbox" className="flex flex-col gap-3">
      <h2 id="gift-inbox" className="sr-only">
        {t("gift.inboxHeading")}
      </h2>
      {waiting.map((gift) => (
        <article
          key={gift.giftId}
          className="flex flex-col gap-4 rounded-card border border-accent/40 bg-accent-subtle p-4 sm:flex-row sm:items-center sm:justify-between"
        >
          <div className="flex items-start gap-3">
            <span
              aria-hidden="true"
              className="flex size-10 shrink-0 items-center justify-center rounded-full bg-accent text-fg-on-accent"
            >
              <Gift className="h-5 w-5" />
            </span>
            <div className="flex flex-col gap-0.5">
              <p className="text-body font-sans font-semibold text-fg">
                {t("gift.receivedFrom", {
                  name: gift.senderDisplayName ?? t("gift.someone"),
                  title: gift.title,
                })}
              </p>
              <p className="text-body-sm font-sans text-fg-muted">
                {gift.merchantName} ·{" "}
                <MoneyAmount
                  amountMinor={gift.faceValueMinor}
                  currency={gift.currency}
                  locale={locale}
                />{" "}
                · {t("gift.acceptBy", { date: formatWalletDate(gift.acceptBy, locale) })}
              </p>
            </div>
          </div>
          <GiftResponseButtons giftId={gift.giftId} title={gift.title} />
        </article>
      ))}
    </section>
  );
}

const STATUS_BADGE = { pending: "info", accepted: "success", returned: "neutral" } as const;

/** 13.20.c: every gift sent and received, newest first. */
export async function WalletGiftsSection({ gifts, locale }: WalletGiftsProps) {
  const t = await getTranslations("wallet");
  const rows = gifts
    .filter((gift) => !isAwaitingMe(gift))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  if (rows.length === 0) return null;
  return (
    <section id="gifts" aria-labelledby="wallet-gifts" className="flex scroll-mt-20 flex-col gap-4">
      <h2 id="wallet-gifts" className="font-display text-headline font-bold text-fg">
        {t("gift.heading")}
      </h2>
      <ul className="divide-y divide-border-subtle overflow-hidden rounded-card border border-border-subtle bg-surface">
        {rows.map((gift) => {
          const sent = gift.direction === "sent";
          const line = sent
            ? t(`gift.sentLine.${gift.status}`, {
                date: formatWalletDate(
                  gift.status === "pending" ? gift.acceptBy : (gift.resolvedAt ?? gift.createdAt),
                  locale,
                ),
              })
            : t("gift.receivedLine", {
                name: gift.senderDisplayName ?? t("gift.someone"),
                date: formatWalletDate(gift.resolvedAt ?? gift.createdAt, locale),
              });
          // A sent gift that went through belongs to someone else now; nothing to open.
          const href =
            sent && gift.status === "accepted" ? null : `/wallet/voucher/${gift.voucherId}`;
          const body = (
            <>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-body-sm font-sans font-semibold text-fg">
                  {gift.title}
                </span>
                <span className="text-caption font-sans text-fg-muted">
                  {sent ? t("gift.sent") : t("gift.received")} · {line}
                </span>
              </span>
              <StatusBadge
                status={STATUS_BADGE[gift.status]}
                emphasis="subtle"
                className="shrink-0"
              >
                {t(`gift.status.${gift.status}`)}
              </StatusBadge>
            </>
          );
          return (
            <li key={gift.giftId}>
              {href ? (
                <a
                  href={href}
                  className="flex items-center gap-3 px-4 py-3 hover:bg-surface-sunken focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus"
                >
                  {body}
                </a>
              ) : (
                <div className="flex items-center gap-3 px-4 py-3">{body}</div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
