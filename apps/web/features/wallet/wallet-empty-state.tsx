import Link from "next/link";
import { Button } from "@yourtal/ui/button";
import { Card, CardContent } from "@yourtal/ui/card";
import { getWalletTranslator, type SupportedLocale } from "./wallet-i18n";

export interface WalletEmptyStateProps {
  /** YT-0405: required, not defaulted — see `store-balance-notice.tsx`'s report for why. */
  locale: SupportedLocale;
}

/**
 * Shown instead of the balance card when the wallet is genuinely empty —
 * zero available, zero pending and zero expiring points, and no vouchers
 * held at all. YT-0423's "empty state teaches the loop rather than showing
 * a zero": a brand-new user should learn how earning works and be pointed
 * straight at the Earn board, not be told "0 poin" and left to guess.
 */
export function WalletEmptyState({ locale }: WalletEmptyStateProps) {
  const t = getWalletTranslator(locale);
  return (
    <Card className="border-dashed">
      <CardContent className="flex flex-col items-center gap-3 p-8 text-center">
        <p className="text-base font-semibold text-fg">{t("emptyState.heading")}</p>
        <p className="max-w-sm text-sm text-fg-muted">{t("emptyState.body")}</p>
        <Button asChild>
          <Link href="/home">{t("emptyState.cta")}</Link>
        </Button>
      </CardContent>
    </Card>
  );
}
