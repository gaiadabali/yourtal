import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { EmptyState } from "@yourtal/ui/empty-state";
import { Button } from "@yourtal/ui/button";

/**
 * Shown instead of the balance card when the wallet is genuinely empty —
 * zero available, zero pending and zero expiring points, and no vouchers
 * held at all (6.5.a: "empty state teaches the loop rather than showing a
 * zero" — a brand-new user should learn how earning works, not be told "0
 * points" and left to guess).
 */
export async function WalletEmptyState() {
  const t = await getTranslations("wallet");
  return (
    <EmptyState
      title={t("emptyState.heading")}
      description={t("emptyState.body")}
      action={
        <Button asChild>
          <Link href="/home">{t("emptyState.cta")}</Link>
        </Button>
      }
    />
  );
}
